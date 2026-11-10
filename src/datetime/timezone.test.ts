// src/datetime/timezone.test.ts
import {
  isCallerTimeZone,
  isPosixSignedZone,
  convertToSiteWallClock,
  convertWallClock,
  formatOffset,
  isValidTimeZone,
  offsetMinutesAt,
  parseOffsetMinutes,
  parseWallClock,
  resolveSiteTimezone,
  siteOffsetMinutes,
} from './timezone';

describe('parseWallClock', () => {
  it('accepts the API format and the ISO "T" separator', () => {
    expect(parseWallClock('2026-11-05 09:30:15')).toEqual({
      year: 2026,
      month: 11,
      day: 5,
      hour: 9,
      minute: 30,
      second: 15,
    });
    expect(parseWallClock('2026-11-05T09:30')?.second).toBe(0);
  });

  it('rejects prose, non-ISO order and out-of-range parts', () => {
    for (const v of [
      'tomorrow 9am',
      '05/11/2026 09:00:00',
      '',
      // A date with no time of day is not a wall clock: there is no time for a zone to shift.
      '2026-11-05',
      '2026-11-05 25:00:00',
      '2026-11-05 09:61:00',
      // An explicit offset is NOT a wall clock — it states its own zone, and reading it as naive
      // would apply the caller's zone on top of one the value already carries.
      '2026-11-05T09:00:00Z',
      '2026-11-05T09:00:00+05:30',
      // 12-hour hours outside 1-12.
      '2026-11-05 13:00 PM',
      '2026-11-05 0:30 AM',
    ]) {
      expect(parseWallClock(v)).toBeNull();
    }
  });

  // The filter schema advertises these as accepted, so a timezone set alongside one of them has
  // to actually apply — it used to do nothing, silently (review of PR #287).
  it('reads the 12-hour form, including the noon and midnight edges', () => {
    expect(parseWallClock('2026-11-05 9:30 AM')?.hour).toBe(9);
    expect(parseWallClock('2026-11-05 9:30 PM')?.hour).toBe(21);
    expect(parseWallClock('2026-11-05 12:00 AM')?.hour).toBe(0);
    expect(parseWallClock('2026-11-05 12:00 PM')?.hour).toBe(12);
    expect(parseWallClock('2026-11-05 12:00pm')?.hour).toBe(12);
  });

  it('reads fractional seconds, discarding the fraction', () => {
    expect(parseWallClock('2026-11-05T09:00:00.123')).toEqual({
      year: 2026,
      month: 11,
      day: 5,
      hour: 9,
      minute: 0,
      second: 0,
    });
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects ambiguous abbreviations', () => {
    for (const tz of ['Asia/Kolkata', 'America/New_York', 'UTC', 'Europe/London']) {
      expect(isValidTimeZone(tz)).toBe(true);
    }
    // ICU ACCEPTS these and pins each to a fixed offset with no DST — PST is GMT-08:00 all
    // year even though California is on -07:00 for most of it. Rejected on purpose, which is
    // why isValidTimeZone is stricter than a bare Intl try/catch.
    for (const tz of ['IST', 'PST', 'EST', 'CST', 'MST', 'GMT', 'EST5EDT', 'Mars/Phobos', '']) {
      expect(isValidTimeZone(tz)).toBe(false);
    }
  });
});

describe('convertWallClock (IANA to IANA)', () => {
  it('converts across a large offset gap', () => {
    const r = convertWallClock('2026-11-05 09:00:00', 'Asia/Kolkata', 'America/New_York');
    expect(r?.converted).toBe('2026-11-04 22:30:00');
    expect(r?.utc).toBe('2026-11-05 03:30:00');
    expect(r?.shifted).toBe(true);
  });

  it('reports shifted=false when nothing moves', () => {
    expect(convertWallClock('2026-11-05 09:00:00', 'UTC', 'UTC')?.shifted).toBe(false);
  });

  it('respects DST on the source side', () => {
    // EST (-05:00) in March before the change, EDT (-04:00) after.
    expect(convertWallClock('2027-03-13 12:00:00', 'America/New_York', 'UTC')?.converted).toBe(
      '2027-03-13 17:00:00',
    );
    expect(convertWallClock('2027-03-14 12:00:00', 'America/New_York', 'UTC')?.converted).toBe(
      '2027-03-14 16:00:00',
    );
  });

  it('handles southern-hemisphere DST and sub-hour zones', () => {
    expect(convertWallClock('2026-12-25 09:00:00', 'Australia/Sydney', 'UTC')?.converted).toBe(
      '2026-12-24 22:00:00',
    );
    expect(convertWallClock('2026-11-05 09:00:00', 'Asia/Kathmandu', 'UTC')?.converted).toBe(
      '2026-11-05 03:15:00',
    );
  });

  it('does not throw on a non-existent or ambiguous wall clock', () => {
    // 02:30 does not exist on US spring-forward; 01:30 happens twice on fall-back.
    expect(
      typeof convertWallClock('2027-03-14 02:30:00', 'America/New_York', 'UTC')?.converted,
    ).toBe('string');
    expect(
      typeof convertWallClock('2026-11-01 01:30:00', 'America/New_York', 'UTC')?.converted,
    ).toBe('string');
  });

  it('returns null for an unparseable datetime', () => {
    expect(convertWallClock('tomorrow', 'UTC', 'UTC')).toBeNull();
  });
});

describe('offsets', () => {
  it('reads and formats offsets', () => {
    expect(offsetMinutesAt(Date.UTC(2026, 10, 5), 'Asia/Kolkata')).toBe(330);
    expect(offsetMinutesAt(Date.UTC(2026, 10, 5), 'UTC')).toBe(0);
    expect(formatOffset(330)).toBe('+05:30');
    expect(formatOffset(-270)).toBe('-04:30');
    expect(formatOffset(0)).toBe('+00:00');
    expect(parseOffsetMinutes('+05:30')).toBe(330);
    expect(parseOffsetMinutes('-04:30')).toBe(-270);
    expect(parseOffsetMinutes('nonsense')).toBeNull();
  });
});

describe('convertToSiteWallClock (legacy fixed-offset sites)', () => {
  it('converts into the site wall clock', () => {
    const r = convertToSiteWallClock('2026-11-05 09:00:00', 'Asia/Kolkata', 'UM5');
    expect(r?.send_as).toBe('2026-11-04 22:30:00');
    expect(r?.utc).toBe('2026-11-05 03:30:00');
    expect(r?.site_utc_offset).toBe('-05:00');
    expect(r?.requested_utc_offset).toBe('+05:30');
    expect(r?.shifted).toBe(true);
  });

  it('leaves the wall clock alone when both sides share an offset', () => {
    const r = convertToSiteWallClock('2026-11-05 09:00:00', 'Asia/Kolkata', 'UP55');
    expect(r?.send_as).toBe('2026-11-05 09:00:00');
    expect(r?.shifted).toBe(false);
  });

  it('shows that a site offset does NOT observe DST', () => {
    // Caller in a DST-aware zone, site pinned to -05:00. In winter they agree; in summer the
    // caller is on -04:00 and the site is still -05:00, so the stored time moves by an hour.
    expect(convertToSiteWallClock('2027-01-15 12:00:00', 'America/New_York', 'UM5')?.send_as).toBe(
      '2027-01-15 12:00:00',
    );
    expect(convertToSiteWallClock('2027-07-15 12:00:00', 'America/New_York', 'UM5')?.send_as).toBe(
      '2027-07-15 11:00:00',
    );
  });

  it('handles a 45-minute site offset', () => {
    expect(convertToSiteWallClock('2026-11-05 00:00:00', 'UTC', 'UP575')?.send_as).toBe(
      '2026-11-05 05:45:00',
    );
  });

  it('returns null for an unknown site code rather than assuming UTC', () => {
    // The API falls back to +0000 for codes it does not know; doing the same here would
    // schedule a send hours from what was intended.
    expect(convertToSiteWallClock('2026-11-05 09:00:00', 'UTC', 'NOT_A_CODE')).toBeNull();
    expect(siteOffsetMinutes('NOT_A_CODE')).toBeNull();
    expect(siteOffsetMinutes('UP55')).toBe(330);
    expect(siteOffsetMinutes('UTC')).toBe(0);
  });
});

describe('resolveSiteTimezone', () => {
  it('classifies a legacy code as a fixed offset', () => {
    expect(resolveSiteTimezone('UP55')).toEqual({ kind: 'offset', offset_minutes: 330 });
    expect(resolveSiteTimezone('UTC')).toEqual({ kind: 'offset', offset_minutes: 0 });
  });

  it('classifies an IANA name as a zone', () => {
    expect(resolveSiteTimezone('Asia/Kolkata')).toEqual({ kind: 'iana', zone: 'Asia/Kolkata' });
    expect(resolveSiteTimezone('America/New_York')).toEqual({
      kind: 'iana',
      zone: 'America/New_York',
    });
  });

  it('returns null for anything neither vocabulary recognises', () => {
    for (const v of ['', '   ', 'NOT_A_CODE', 'IST', 'Mars/Olympus']) {
      expect(resolveSiteTimezone(v)).toBeNull();
    }
  });
});

describe('convertToSiteWallClock (IANA site timezones)', () => {
  // Regression: PR #287 shipped with the code table as the ONLY accepted vocabulary, so
  // schedule_timezone hard-failed on every site QA tried. Prod serves IANA names; the API's
  // localToUtc falls through to moment-timezone for them.

  it('converts into an IANA site wall clock', () => {
    const r = convertToSiteWallClock('2026-11-05 09:00:00', 'America/New_York', 'Asia/Kolkata');
    expect(r?.send_as).toBe('2026-11-05 19:30:00');
    expect(r?.utc).toBe('2026-11-05 14:00:00');
    expect(r?.site_utc_offset).toBe('+05:30');
    expect(r?.site_timezone_kind).toBe('iana');
    expect(r?.shifted).toBe(true);
  });

  it('is a no-op when caller and site share a zone', () => {
    const r = convertToSiteWallClock('2026-11-05 09:00:00', 'Asia/Kolkata', 'Asia/Kolkata');
    expect(r?.send_as).toBe('2026-11-05 09:00:00');
    expect(r?.shifted).toBe(false);
  });

  it('observes DST on the site side, unlike a fixed-offset site', () => {
    // Same wall clock, same zones, two sides of a DST boundary. An IANA site keeps the caller's
    // 12:00 intact all year because both sides shift together...
    expect(
      convertToSiteWallClock('2027-01-15 12:00:00', 'America/New_York', 'America/New_York')
        ?.send_as,
    ).toBe('2027-01-15 12:00:00');
    expect(
      convertToSiteWallClock('2027-07-15 12:00:00', 'America/New_York', 'America/New_York')
        ?.send_as,
    ).toBe('2027-07-15 12:00:00');
    // ...whereas the equivalent fixed-offset site drifts by an hour in summer.
    expect(convertToSiteWallClock('2027-07-15 12:00:00', 'America/New_York', 'UM5')?.send_as).toBe(
      '2027-07-15 11:00:00',
    );
  });

  it('reports the offset in force on that date, not a constant', () => {
    expect(
      convertToSiteWallClock('2027-01-15 12:00:00', 'UTC', 'America/New_York')?.site_utc_offset,
    ).toBe('-05:00');
    expect(
      convertToSiteWallClock('2027-07-15 12:00:00', 'UTC', 'America/New_York')?.site_utc_offset,
    ).toBe('-04:00');
  });

  it('prefers the code table when a value appears in both', () => {
    // 'UTC' is in the code table and is also a valid Intl zone. The API consults
    // getOffsetByTimezone first, so the offset branch must win.
    expect(convertToSiteWallClock('2026-11-05 09:00:00', 'UTC', 'UTC')?.site_timezone_kind).toBe(
      'offset',
    );
  });
});

describe('caller zones vs site zones', () => {
  /**
   * The asymmetry is deliberate. A CALLER's zone is a guess at what a person meant, so a form
   * that invites a sign error is refused — they can name the place instead. A SITE's zone is
   * authoritative data we must honour whatever it says: refusing one would fail every send on
   * that site, which is the fail-closed bug QA hit with IANA site zones on PR #287.
   */
  it('refuses a sign-inverted zone from a caller but accepts it as a site timezone', () => {
    expect(isPosixSignedZone('Etc/GMT+5')).toBe(true);
    expect(isCallerTimeZone('Etc/GMT+5')).toBe(false);
    expect(resolveSiteTimezone('Etc/GMT+5')).toEqual({ kind: 'iana', zone: 'Etc/GMT+5' });
  });

  it('leaves the unsigned Etc zones alone', () => {
    for (const tz of ['Etc/UTC', 'Etc/GMT', 'Etc/Greenwich']) {
      expect(isPosixSignedZone(tz)).toBe(false);
      expect(isCallerTimeZone(tz)).toBe(true);
    }
  });

  it('still refuses what isValidTimeZone refuses', () => {
    for (const tz of ['IST', 'PST', 'Not/AZone', '']) {
      expect(isCallerTimeZone(tz)).toBe(false);
    }
  });

  it('applies Etc/GMT+5 as UTC-5 when a site really is set to it', () => {
    // Proof the acceptance above is harmless: the conversion is correct, it is only the WRITING
    // that is a trap. 09:00 in Kolkata is 03:30 UTC, which is 22:30 the previous day at UTC-5.
    const conversion = convertToSiteWallClock('2026-12-01 09:00:00', 'Asia/Kolkata', 'Etc/GMT+5');
    expect(conversion?.send_as).toBe('2026-11-30 22:30:00');
    expect(conversion?.site_utc_offset).toBe('-05:00');
  });
});
