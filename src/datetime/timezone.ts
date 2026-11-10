// src/datetime/timezone.ts
//
// Wall-clock conversion between IANA timezones, using only `Intl` — this package has three
// runtime dependencies and a date library is not worth a fourth.
//
// WHY THIS EXISTS
//
// `schedule_date` is a NAIVE datetime (`YYYY-MM-DD HH:mm:ss`) and the API interprets it in the
// SITE's timezone, then converts to UTC for storage:
//   app/Formatters/Dashboard/Notification.js:292
//     formattedData[N_COL.scheduleDate] = moment.localToUtc(scheduleDate, timezone)
//
// So a bare "09:00:00" means 9am where the *site* is configured, not where the person asking
// happens to be. Someone in Asia/Kolkata scheduling "9am" for a site set to America/New_York gets
// a notification 10.5 hours away from what they meant, with nothing in the response to reveal it.
// This module converts the caller's wall clock into the site's, so the request carries what the
// API expects and the response can state plainly what was actually scheduled.

/** The API's datetime format, in both directions. */
export const API_DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';

/**
 * A naive wall clock that names a TIME OF DAY: `YYYY-MM-DD[ T]HH:mm[:ss]`, the same with
 * fractional seconds, and the 12-hour `YYYY-MM-DD h:mm AM` form.
 *
 * The last two were added because `subscriberFilter/schema.ts` advertises them as accepted while
 * this read only the 24-hour form, so a timezone set alongside one of them did nothing and said
 * nothing — us not honouring our own documented input (review of PR #287).
 *
 * Two forms are deliberately NOT matched. A value carrying `Z` or an explicit offset already
 * states its own zone, and callers skip it before reaching here. A date with no time of day is
 * not a wall clock at all: picking one would invent precision the caller never gave, which is a
 * decision of this project's rather than an oversight — see `convertFilterDatesToUtc`.
 */
const DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?[ ]?([AaPp][Mm])?$/;

export type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/**
 * Read a naive wall clock. Returns null for anything this cannot represent exactly — a date with
 * no time of day included — so a caller can fail or skip rather than convert a value it misread.
 */
export function parseWallClock(value: string): WallClock | null {
  const m = DATETIME_RE.exec(value.trim());
  if (!m) return null;

  const meridiem = m[7]?.toLowerCase();
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] ? Number(m[6]) : 0;

  if (meridiem) {
    // 12 AM is 00, 12 PM is 12, everything else shifts by 12 in the afternoon.
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'am') hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (hour > 23) {
    return null;
  }

  if (minute > 59 || second > 59) return null;

  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour,
    minute,
    second,
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function formatWallClock(w: WallClock): string {
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`;
}

/**
 * True for a real IANA zone name (`Area/Location`, or `UTC`).
 *
 * Deliberately stricter than `Intl` alone. ICU happily accepts bare abbreviations — `PST`, `EST`,
 * `IST`, `CST` — and resolves each to a FIXED offset with no DST rule: `PST` is `GMT-08:00` all
 * year, although California is on `-07:00` for about eight months of it. Accepting one would
 * schedule a send an hour off for most of the year, silently, which is the exact failure this
 * module exists to prevent. `IST` is worse again, meaning Indian, Irish or Israel Standard Time
 * depending on who typed it.
 *
 * Legacy forms without a region (`EST5EDT`, `GMT`) are rejected for the same reason: the caller
 * should name a place, which is unambiguous, rather than an abbreviation, which is not.
 */
export function isValidTimeZone(timeZone: string): boolean {
  const name = timeZone.trim();
  if (name === '') return false;
  if (!name.includes('/') && name.toUpperCase() !== 'UTC') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/**
 * True for `Etc/GMT+5` and friends, which mean the OPPOSITE of what they read like.
 *
 * The `Etc/GMT±N` zones follow the POSIX sign convention, so `Etc/GMT+5` is five hours BEHIND UTC
 * and `Etc/GMT-5` is five hours ahead. `Intl` accepts both and applies them correctly, so nothing
 * here is broken — the danger is entirely in the writing: a model that emits `Etc/GMT+5` meaning
 * +05:00 gets a ten-hour error with a clean response, which is the same silent failure the
 * abbreviation rejection exists to stop. Caught in review of PR #287.
 *
 * `Etc/UTC`, `Etc/GMT` and `Etc/Greenwich` carry no sign and are not affected.
 */
const POSIX_SIGNED_ZONE_RE = /^Etc\/GMT[+-]\d/i;

export function isPosixSignedZone(timeZone: string): boolean {
  return POSIX_SIGNED_ZONE_RE.test(timeZone.trim());
}

/**
 * A timezone a CALLER may name, which is stricter than one a SITE may be stored as.
 *
 * The difference is intent, and where the value comes from. A caller's zone is free text from a
 * model, so a written form that invites a sign error is refused — a place name is always
 * available instead. A site's zone is authoritative stored data, so `resolveSiteTimezone`
 * deliberately does NOT apply this rule: it has to read whatever is there, and `Intl` applies the
 * Etc zones correctly, so rejecting one would fail a send closed for no benefit — the failure
 * mode QA hit with IANA site zones on PR #287.
 *
 * Worth knowing when reading that: the API will not *write* an Etc zone to a site. Its validator
 * is `Joi.valid(getTimezoneNames())` (app/Validators/Dashboard/Schema/SiteSetting/Timezone.js),
 * and that list is filtered to `Area/Location` plus `UTC`
 * (peModules/MomentTimezone/Timezone.js:11) — which also excludes the legacy `UP55` codes, so
 * those survive only as stored data. An Etc site timezone is therefore not reachable through any
 * current write path; being permissive here costs nothing and guards the legacy case.
 */
export function isCallerTimeZone(timeZone: string): boolean {
  if (isPosixSignedZone(timeZone)) return false;
  return isValidTimeZone(timeZone);
}

/**
 * The wall clock shown in `timeZone` at a given UTC instant.
 *
 * `formatToParts` with an explicit timeZone is the only dependency-free way to read a zone's
 * local time, including whatever DST rule applies on that date.
 */
export function wallClockAt(instantMs: number, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(instantMs));

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // `hour12: false` renders midnight as 24 in some ICU versions; normalize it.
  const hour = get('hour');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: hour === 24 ? 0 : hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Treat the wall clock as if it were UTC, in epoch ms. Used as the fixed point for solving. */
function wallClockAsUtcMs(w: WallClock): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

/**
 * The UTC instant at which `timeZone` shows this wall clock.
 *
 * Solved rather than computed, because a zone's offset depends on the instant and the instant is
 * what we're solving for. Two passes converge everywhere outside a DST transition; the third
 * guards the transition itself. Where a wall clock does not exist (the spring-forward gap) or
 * happens twice (the autumn overlap), this settles on one consistent answer instead of throwing —
 * scheduling is not precise enough for that to matter, and failing a send over it would be worse.
 */
export function wallClockToUtcMs(w: WallClock, timeZone: string): number {
  const target = wallClockAsUtcMs(w);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const shown = wallClockAsUtcMs(wallClockAt(guess, timeZone));
    const drift = target - shown;
    if (drift === 0) break;
    guess += drift;
  }
  return guess;
}

/** Offset of `timeZone` from UTC in minutes at a given instant (positive = ahead of UTC). */
export function offsetMinutesAt(instantMs: number, timeZone: string): number {
  const shown = wallClockAsUtcMs(wallClockAt(instantMs, timeZone));
  return Math.round((shown - instantMs) / 60000);
}

/** `+05:30` / `-04:00` / `+00:00`, for stating an offset to a human. */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export type ConversionResult = {
  /** The converted wall clock, in `API_DATETIME_FORMAT`, ready for the API. */
  converted: string;
  /** The input as given, normalized to `API_DATETIME_FORMAT`. */
  original: string;
  from_timezone: string;
  to_timezone: string;
  from_utc_offset: string;
  to_utc_offset: string;
  /** The same instant in UTC, so a human can sanity-check the result. */
  utc: string;
  /** False when both zones were at the same offset for this instant — nothing moved. */
  shifted: boolean;
};

/**
 * Reinterpret a naive wall clock from one timezone into another.
 *
 * Both inputs must be IANA names; validate with `isValidTimeZone` first.
 */
export function convertWallClock(
  value: string,
  fromTimeZone: string,
  toTimeZone: string,
): ConversionResult | null {
  const parsed = parseWallClock(value);
  if (!parsed) return null;

  const instantMs = wallClockToUtcMs(parsed, fromTimeZone);
  const target = wallClockAt(instantMs, toTimeZone);
  const converted = formatWallClock(target);
  const original = formatWallClock(parsed);

  return {
    converted,
    original,
    from_timezone: fromTimeZone,
    to_timezone: toTimeZone,
    from_utc_offset: formatOffset(offsetMinutesAt(instantMs, fromTimeZone)),
    to_utc_offset: formatOffset(offsetMinutesAt(instantMs, toTimeZone)),
    utc: formatWallClock(wallClockAt(instantMs, 'UTC')),
    shifted: converted !== original,
  };
}

// ---------------------------------------------------------------------------------------
// A site timezone is EITHER a legacy fixed-offset code OR an IANA zone name
// ---------------------------------------------------------------------------------------
//
// Both vocabularies are live, and they behave differently. `localToUtc`
// (pushengage-adonis-node-api, peModules/MomentTimezone/Moment.js:197) decides between them:
//
//   const offset = timezone.getOffsetByTimezone(dateTimezone);   // '+0000' when not in the table
//   if (offset !== '+0000' || !dateTimezone) { ...fixed-offset path... }
//   return momentBase.tz(date, dateTimezone).utc();              // ...IANA path, DST-aware...
//
//  1. LEGACY CODES (`UM5`, `UP55`, …) are one of 40 values from the API's own
//     storage/JSON/Timezone.json, each pinned to a CONSTANT offset. A site on `UM5` stays at
//     -05:00 all year, so it tracks New York in winter and is an hour off it in summer. A "9am"
//     schedule drifts against the wall clock people there actually read.
//  2. IANA NAMES (`Asia/Kolkata`, `America/New_York`) fall through to moment-timezone and get
//     REAL daylight-saving handling. These are what prod actually returns: QA on PR #287 found
//     6 of 6 sites on `Asia/Kolkata` or `UTC` and none on a code. The package's own
//     `update_site_details` documents the field as IANA.
//
// So the code table is the fallback, not the primary. It is still mirrored here because
// `GET misc/timezones` does NOT serve this vocabulary — it returns IANA names from
// moment-timezone for subscriber/device timezones, and no endpoint maps a site code to its
// offset. It has been stable, but it IS a duplicate: if the API's table changes, this must
// follow.
export const SITE_TIMEZONE_OFFSETS: Readonly<Record<string, string>> = Object.freeze({
  UM12: '-12:00',
  UM11: '-11:00',
  UM10: '-10:00',
  UM95: '-09:30',
  UM9: '-09:00',
  UM8: '-08:00',
  UM7: '-07:00',
  UM6: '-06:00',
  UM5: '-05:00',
  UM45: '-04:30',
  UM4: '-04:00',
  UM35: '-03:30',
  UM3: '-03:00',
  UM2: '-02:00',
  UM1: '-01:00',
  UTC: '+00:00',
  UP1: '+01:00',
  UP2: '+02:00',
  UP3: '+03:00',
  UP35: '+03:30',
  UP4: '+04:00',
  UP45: '+04:30',
  UP5: '+05:00',
  UP55: '+05:30',
  UP575: '+05:45',
  UP6: '+06:00',
  UP65: '+06:30',
  UP7: '+07:00',
  UP8: '+08:00',
  UP875: '+08:45',
  UP9: '+09:00',
  UP95: '+09:30',
  UP10: '+10:00',
  UP105: '+10:30',
  UP11: '+11:00',
  UP115: '+11:30',
  UP12: '+12:00',
  UP1275: '+12:45',
  UP13: '+13:00',
  UP14: '+14:00',
});

const OFFSET_RE = /^([+-])(\d{2}):?(\d{2})$/;

/** `+05:30` → 330. Returns null for anything unparseable. */
export function parseOffsetMinutes(offset: string): number | null {
  const m = OFFSET_RE.exec(offset.trim());
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -minutes : minutes;
}

/**
 * The site's UTC offset in minutes for a LEGACY CODE, or null when the code is not in the table.
 *
 * Null is deliberately NOT treated as `+00:00` here, even though the API falls back to that:
 * silently scheduling against the wrong offset is exactly the failure this module exists to stop.
 * Use `resolveSiteTimezone` instead unless you specifically want the code table.
 */
export function siteOffsetMinutes(siteTimezoneCode: string): number | null {
  const offset = SITE_TIMEZONE_OFFSETS[siteTimezoneCode.trim()];
  return offset ? parseOffsetMinutes(offset) : null;
}

/** Which of the two site-timezone vocabularies a value belongs to. */
export type SiteTimezone =
  | { kind: 'offset'; offset_minutes: number }
  | { kind: 'iana'; zone: string };

/**
 * Classify a site timezone the same way the API's `localToUtc` does: legacy code first, then
 * IANA, and null for anything neither recognises.
 *
 * Order matters and matches the API. `getOffsetByTimezone` is consulted first, so a value in the
 * code table is a fixed offset even if it also happened to parse as something else.
 */
export function resolveSiteTimezone(siteTimezone: string): SiteTimezone | null {
  const name = siteTimezone.trim();
  if (name === '') return null;

  const offset = SITE_TIMEZONE_OFFSETS[name];
  if (offset) {
    const minutes = parseOffsetMinutes(offset);
    return minutes === null ? null : { kind: 'offset', offset_minutes: minutes };
  }

  return isValidTimeZone(name) ? { kind: 'iana', zone: name } : null;
}

export type ScheduleConversion = {
  /** Site-local wall clock, in `API_DATETIME_FORMAT` — this is what the API is sent. */
  send_as: string;
  /** What the caller asked for, normalized. */
  requested: string;
  requested_timezone: string;
  requested_utc_offset: string;
  site_timezone: string;
  site_utc_offset: string;
  /**
   * Which vocabulary the site timezone used. `offset` sites have no daylight saving, so the
   * stored wall clock for the same instant shifts by an hour across a DST boundary; `iana` sites
   * behave the way the people reading that clock expect.
   */
  site_timezone_kind: 'offset' | 'iana';
  utc: string;
  /** False when the two offsets matched and the wall clock is unchanged. */
  shifted: boolean;
};

/**
 * Reinterpret a wall clock given in an IANA timezone as the site's wall clock.
 *
 * The caller's side is always DST-aware (via `Intl`). The site's side follows whichever
 * vocabulary its timezone belongs to, mirroring `localToUtc`: a legacy code is a constant offset,
 * an IANA name gets real DST handling. The result is what `schedule_date` must carry for the API
 * to schedule the instant the caller meant.
 */
export function convertToSiteWallClock(
  value: string,
  fromTimeZone: string,
  siteTimezone: string,
): ScheduleConversion | null {
  const parsed = parseWallClock(value);
  if (!parsed) return null;
  const site = resolveSiteTimezone(siteTimezone);
  if (site === null) return null;

  const instantMs = wallClockToUtcMs(parsed, fromTimeZone);

  // For a fixed offset, fold it in and read the result in UTC. For an IANA zone, read the instant
  // in that zone directly so the offset in force on that date (DST included) is the one applied.
  const sendAs =
    site.kind === 'offset'
      ? formatWallClock(wallClockAt(instantMs + site.offset_minutes * 60000, 'UTC'))
      : formatWallClock(wallClockAt(instantMs, site.zone));

  const siteOffset =
    site.kind === 'offset' ? site.offset_minutes : offsetMinutesAt(instantMs, site.zone);

  const requested = formatWallClock(parsed);

  return {
    send_as: sendAs,
    requested,
    requested_timezone: fromTimeZone,
    requested_utc_offset: formatOffset(offsetMinutesAt(instantMs, fromTimeZone)),
    site_timezone: siteTimezone,
    site_utc_offset: formatOffset(siteOffset),
    site_timezone_kind: site.kind,
    utc: formatWallClock(wallClockAt(instantMs, 'UTC')),
    shifted: sendAs !== requested,
  };
}
