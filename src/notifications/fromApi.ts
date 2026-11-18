// src/notifications/fromApi.ts
//
// Turns a notification READ back into the shape `pushengage_send_notification` takes, so an edit
// can be expressed as "fetch, overlay the changed fields, send the whole thing again".
//
// WHY THIS FILE EXISTS
//
// `PATCH /sites/:siteId/notifications/:id` is NOT a partial update. It validates against the same
// `upsert` schema as the create route (pushengage-adonis-node-api,
// app/Controllers/Http/Dashboard/NotificationController.js:493), where `notification_title`,
// `notification_message`, `notification_url` (app/Validators/Helper.js:114-142) and `status`
// (Schema/Notification/index.js:202) are all required — so a body carrying only the changed field
// is rejected outright. Worse, the fields that are NOT required do not simply keep their old
// values: `notificationFormatter.upsert` rewrites them from whatever arrived, so omitting
// `big_image_url` nulls it, omitting `image_url` resets it to the site default, and omitting
// `notification_criteria` drops the targeting, which the API reads as "all subscribers".
//
// So the only safe way to change one field is to send every other field back exactly as it was.
// This module reconstructs that payload from the API's own read.
//
// WHY THE ROUND TRIP IS FAITHFUL
//
// The read transformer is the deliberate inverse of the write formatter, which is what makes this
// work at all (app/Transformers/Dashboard/Notification/index.js):
//
//   - `notification_url` has its UTM params STRIPPED on read (`removeUtmParamsFromUrl`) and
//     re-added on write (`addUtmParamsToUrl`), so the bare url round-trips.
//   - `actions` is rebuilt into an array from the flat `action1_*` / `action2_*` columns, which
//     is the same array shape the write side flattens again.
//   - `notification_criteria.audience` keeps its `groups` ids and merely ADDS a `group_list` of
//     `{id, name}` for display (app/Helpers/NotificationTransformer.js:128); a `segments` filter
//     rule likewise keeps its ids in `value` and adds `segment_list`
//     (app/Helpers/Notification.js:1451). Both extras are dropped here.
//   - `valid_from` is `moment.utcToLocal(schedule_date, siteTimezone)`, i.e. the SITE's wall
//     clock, which is exactly how the write side reads `schedule_date`. No conversion either way.
//
// The one lossy spot is by design upstream: `transformSegment` drops a `segments` rule whose
// segment no longer exists, so re-sending a filter built from an old notification can quietly
// lose such a rule. The filter is re-resolved against the site before any update, so an
// unresolvable reference fails the call rather than widening the send.

/** Stored statuses the API will accept an update for (everything else is refused below). */
const EDITABLE_STATUSES = ['draft', 'scheduled', 'repeat_scheduled', 'pause_repeat_scheduled'];

/**
 * Why a given notification cannot be edited, phrased for the assistant to relay.
 *
 * Each case mirrors a refusal the API itself makes in `notificationService.updateNotification`
 * (app/Services/Dashboard/Notification/index.js:458-479), except the A/B one, which the API does
 * NOT refuse — it quietly deletes the variants. See below.
 */
export function whyNotEditable(raw: Record<string, unknown>): string | null {
  const status = typeof raw.status === 'string' ? raw.status : '';
  const source = typeof raw.source === 'string' ? raw.source : '';

  if (source === 'A' || source === 'B' || source === 'C') {
    // The API treats an update body with no `A` key on an A/B notification as "remove the test":
    // `abTestAction = 'remove'` deletes the B (and C) notifications outright
    // (NotificationController.js:450 and Services/.../index.js:520-551). Sending a reconstructed
    // generic body here would therefore destroy the variants as a side effect of changing a
    // title, so this tool refuses instead.
    // 'B' is a read-side value: the transformer rewrites a B variant's source to 'B'
    // (app/Transformers/Dashboard/Notification/index.js:253). Editing one through the generic
    // path would rewrite its source to API and detach it from its test, so it is refused with the
    // others — raised in review of PR #290.
    return (
      'This is part of an A/B test, and editing it here would break the test — an update without ' +
      'A/B content makes the API remove the test and delete the other variant. Edit it in the ' +
      'dashboard, or send a new A/B notification with pushengage_send_ab_notification.'
    );
  }
  if (source === 'rss_feed') {
    return 'RSS auto-push notifications cannot be edited; the API refuses them. Change the RSS campaign settings instead.';
  }
  if (status === 'sent' || status === 'sending') {
    if (source === 'parent_sub_timezone') {
      // Worth distinguishing: the fan-out cron flips the parent to `sent` as much as 14 hours
      // before the first child is actually delivered, so "already sent" reads as wrong to a user
      // whose send is still in the future.
      return (
        'This subscriber-timezone notification has already been handed to the delivery job, which ' +
        'happens up to 14 hours before the first timezone is due, so it can no longer be edited. ' +
        'Cancel it in the dashboard and schedule a new one.'
      );
    }
    return 'This notification has already been sent and cannot be edited. Use pushengage_send_notification to send a new one.';
  }
  // Unlike delete and resend, `updateNotification` has NO source allowlist
  // (app/Services/Dashboard/Notification/index.js:435-479), so an unsupported source is not
  // refused by the API -- it is relabelled `source: 'API'` and saved. For a `sub_timezone` child
  // that detaches it from its parent's cancel and delete. Refused here instead, since the API will
  // not do it for us. Raised in review of PR #290.
  const unsupported = unsupportedSource(source, 'edit');
  if (unsupported) return unsupported;

  if (!EDITABLE_STATUSES.includes(status)) {
    return `A notification with status "${status || '(unknown)'}" cannot be edited. Only drafts, scheduled and recurring notifications can.`;
  }
  return null;
}

/**
 * The sources the delete and resend services will even look up.
 *
 * Both fetch with a source allowlist — `api`, `dashboard`, `Dashboard`, `rss_feed`,
 * `parent_sub_timezone`, `repeat_scheduled`, `zapier` and WordPress-like
 * (app/Services/Dashboard/Notification/index.js:797-808) — and anything else simply does not match,
 * so the API answers `notification not found` for a notification that plainly exists. `A` is the
 * exception: the controller routes it to the dedicated A/B service before the generic one.
 * Raised in review of PR #290.
 */
const LIFECYCLE_SOURCES = [
  'API',
  'dashboard',
  'Dashboard',
  'rss_feed',
  'parent_sub_timezone',
  'repeat_scheduled',
  'zapier',
];

function unsupportedSource(source: string, verb: string): string | null {
  // `wordPress: 'wordpress'` -- the CONSTANT is camelCase, the VALUE is lowercase, and the
  // repository matches it with a SQL LIKE that ignores case. Comparing against 'wordPress' never
  // matched a real value, so WordPress notifications were refused outright (review of PR #290).
  if (
    source === '' ||
    LIFECYCLE_SOURCES.includes(source) ||
    source.toLowerCase().startsWith('wordpress')
  ) {
    return null;
  }
  if (source === 'B' || source === 'C') {
    return `This is one variant of an A/B test, and the API cannot ${verb} a variant on its own — only the test as a whole, through its A notification.`;
  }
  if (source === 'Drip' || source === 'Dripper') {
    return `This notification belongs to a drip campaign, which the API will not ${verb} here. Manage it from the campaign instead.`;
  }
  if (source === 'Trigger') {
    return `This notification belongs to a triggered campaign, which the API will not ${verb} here. Manage it from the campaign instead.`;
  }
  if (source === 'sub_timezone') {
    return `This is one timezone's copy of a subscriber-timezone broadcast; the API will not ${verb} a single copy. Act on the parent notification instead.`;
  }
  return `The API will not ${verb} a notification from source "${source}" — it answers "not found" rather than refusing, which is why this is caught here.`;
}

/**
 * Flatten the shape a single-notification read returns for an A/B parent.
 *
 * `GET /sites/:siteId/notifications/:id` does NOT return a flat notification when the source is
 * `A`. The service branches to `getAbNotification` and the transformer answers
 * `{ ab, A, B }` (app/Transformers/Dashboard/Notification/index.js:441-443), which the dashboard
 * detects as `res.data.A && res.data.B`.
 *
 * Read flat, every field is undefined: `source` and `status` come back empty, so the A/B refusals
 * reported `status "(unknown)"`, delete and resend refused a parent the API supports, and
 * duplicate failed with no title. Every A/B fixture in the tests was a flat `{ status, source: 'A' }`,
 * which is why none of it showed. Raised in review of PR #290.
 *
 * The flattened form takes the content from `A` and the status from `ab`, and forces
 * `source: 'A'` so the A/B guards recognise it however the payload is shaped.
 */
export function flattenAbRead(raw: Record<string, unknown>): Record<string, unknown> {
  const a = raw.A;
  const b = raw.B;
  if (!a || typeof a !== 'object' || !b || typeof b !== 'object') return raw;

  const variantA = a as Record<string, unknown>;
  const ab = raw.ab && typeof raw.ab === 'object' ? (raw.ab as Record<string, unknown>) : {};
  return {
    ...variantA,
    ...(ab.status !== undefined ? { status: ab.status } : {}),
    ab_notification_id: ab.id ?? ab.ab_notification_id,
    source: 'A',
  };
}

/** The subset of `pushengage_send_notification`'s input that a read can reconstruct. */
export type ReconstructedSendInput = {
  title?: string;
  message?: string;
  url?: string;
  status?: 'sent' | 'schedule' | 'draft';
  schedule_date?: string;
  image_url?: string;
  big_image_url?: string;
  actions?: Array<{ label: string; url: string; image_url?: string }>;
  expire_in?: number;
  tags?: string[];
  utm_params?: Record<string, unknown>;
  audience_groups?: number[];
  subscriber_filter?: unknown;
  send_in_subscribers_timezone?: boolean;
  recurring_schedule?: {
    days: string[];
    times: string[];
    start_date: string;
    end_date: string;
  };
  android_push?: unknown;
  ios_push?: unknown;
  mobile_push?: unknown;
  /**
   * Also replayed, never input, for the same reason as `mobile_push`: the API rebuilds these from
   * the body on every update, so omitting them destroys what was there.
   *
   * - `execution_state` holds the sample limit and goal tracking
   *   (`notificationExecutionState`, NotificationFormatter.js:331). An edit without it wipes the
   *   limit, so a send restricted to a sample reaches the full audience after a title change.
   * - `interaction` (`require_interaction`) is defaulted to **1** by the validator when omitted
   *   (app/Validators/Helper.js:383), so a notification saved with it off switches back on after
   *   any edit.
   *
   * Raised in review of PR #290.
   */
  execution_state?: unknown;
  interaction?: unknown;
  /**
   * The notification's existing `source`, carried so an EDIT does not relabel it.
   *
   * Not a tool input — like `mobile_push`, it is replayed and never constructed, so the model
   * cannot claim to be Zapier or the dashboard. Only the values the upsert validator accepts are
   * kept (`Validators/Dashboard/Schema/Notification/Helper.js:209-218`); anything else, such as the
   * legacy `dashboard` value, would 422 and falls back to `API`.
   */
  source?: string;
};

/**
 * `source` values the upsert validator accepts. The delivery-mode values are excluded on purpose:
 * `toApiBody` decides those from the input, so replaying them would let a stale read override the
 * mode the caller actually asked for.
 */
const PRESERVABLE_SOURCES = ['API', 'Dashboard', 'wordpress', 'zapier'];

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v : undefined;
const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};

/**
 * Stored status -> the status the WRITE side takes.
 *
 * The two vocabularies differ, which is easy to miss: a scheduled notification is stored as
 * `scheduled` but written as `schedule`, and the recurring statuses are written as a normal send
 * whose recurrence lives in `sche_options` (`toApiBody` turns that into
 * `source: 'repeat_scheduled'`). Draft-ness travels in the `action` query param, not the body.
 */
function toInputStatus(status: string): ReconstructedSendInput['status'] {
  if (status === 'draft') return 'draft';
  if (status === 'scheduled') return 'schedule';
  return 'sent';
}

function toActions(value: unknown): ReconstructedSendInput['actions'] {
  if (!Array.isArray(value)) return undefined;
  const out: NonNullable<ReconstructedSendInput['actions']> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    // The read uses `title` for the button label on some payloads and `label` on others; the
    // write side only accepts `label`.
    const label = str(raw.label) ?? str(raw.title);
    const url = str(raw.url);
    if (label === undefined || url === undefined) continue;
    const image = str(raw.image_url);
    out.push(image === undefined ? { label, url } : { label, url, image_url: image });
  }
  return out.length > 0 ? out : undefined;
}

/** Drop the display-only companions the read adds next to the ids the write side needs. */
function cleanFilter(filter: unknown): unknown {
  if (!filter || typeof filter !== 'object') return filter;
  const f = filter as { op?: unknown; value?: unknown };
  if (!Array.isArray(f.value)) return filter;
  const value = f.value.map((group) =>
    Array.isArray(group)
      ? group.map((rule) => {
          if (!rule || typeof rule !== 'object') return rule;
          const { segment_list: _segmentList, ...rest } = rule as Record<string, unknown>;
          return rest;
        })
      : group,
  );
  return { ...(typeof f.op === 'string' ? { op: f.op } : {}), value };
}

/**
 * Rebuild the create-shaped input from a notification read.
 *
 * Only fields the read actually carries are set, so the result can be spread under the caller's
 * overrides and handed straight to `SendNotificationInputSchema` — which then applies every
 * cross-field rule the create path already enforces.
 */
export function notificationToSendInput(raw: Record<string, unknown>): ReconstructedSendInput {
  const out: ReconstructedSendInput = {};

  const title = str(raw.notification_title);
  if (title !== undefined) out.title = title;
  const message = str(raw.notification_message);
  if (message !== undefined) out.message = message;
  const url = str(raw.notification_url);
  if (url !== undefined) out.url = url;

  const status = typeof raw.status === 'string' ? raw.status : '';
  out.status = toInputStatus(status);

  // The API's own column names, NOT the MCP's input names: `notification_image` and `big_image`
  // (storage/Models/Notification/Notification.js:11,18). `api.ts`'s list adapter already reads
  // them this way. Reading `image_url` / `big_image_url` here found nothing, so every edit reset
  // the icon to the site default and nulled the big image — raised in review of PR #290.
  const image = str(raw.notification_image) ?? str(raw.image_url);
  if (image !== undefined) out.image_url = image;
  const bigImage = str(raw.big_image) ?? str(raw.big_image_url);
  if (bigImage !== undefined) out.big_image_url = bigImage;

  const actions = toActions(raw.actions);
  if (actions !== undefined) out.actions = actions;

  const expiry = num(raw.expiry) ?? num(raw.expire_in);
  if (expiry !== undefined) out.expire_in = expiry;

  if (Array.isArray(raw.tags)) {
    const tags = raw.tags.filter((t): t is string => typeof t === 'string');
    if (tags.length > 0) out.tags = tags;
  }

  if (raw.utm_params && typeof raw.utm_params === 'object' && !Array.isArray(raw.utm_params)) {
    out.utm_params = raw.utm_params as Record<string, unknown>;
  }

  // Targeting: audience groups and the custom filter are mutually exclusive on the input side,
  // and the read carries at most one of them.
  const criteria =
    raw.notification_criteria && typeof raw.notification_criteria === 'object'
      ? (raw.notification_criteria as Record<string, unknown>)
      : undefined;
  if (criteria) {
    const audience =
      criteria.audience && typeof criteria.audience === 'object'
        ? (criteria.audience as Record<string, unknown>)
        : undefined;
    if (audience && Array.isArray(audience.groups)) {
      const groups = audience.groups.map((g) => num(g)).filter((g): g is number => g !== undefined);
      if (groups.length > 0) out.audience_groups = groups;
    }
    if (criteria.filter !== undefined && criteria.filter !== null) {
      out.subscriber_filter = cleanFilter(criteria.filter);
    }
  }

  const source = typeof raw.source === 'string' ? raw.source : '';
  // Only when the status can carry it. The schema allows the flag solely with
  // status="schedule", so a subscriber-timezone DRAFT (source parent_sub_timezone + status draft)
  // reconstructed with the flag set failed validation on every edit — raised in review of PR #290.

  // `valid_from` is already the site's wall clock on read, which is how the write side reads
  // `schedule_date` — no conversion in either direction.
  //
  // Kept for a DRAFT as well as a scheduled send. A draft of a scheduled send stores its time in
  // `valid_from` (the dashboard posts `status: scheduled` + `valid_from` under `?action=draft`),
  // so dropping it here stripped the time from any draft that had one. The zero date is the
  // API's "no date" sentinel and must not be replayed. Review of PR #290.
  const scheduleDate = str(raw.valid_from) ?? str(raw.schedule_date);
  const hasRealDate = scheduleDate !== undefined && !scheduleDate.startsWith('0000-00-00');
  if (hasRealDate && (out.status === 'schedule' || out.status === 'draft')) {
    out.schedule_date = scheduleDate;
  }

  // Decided AFTER the date, because a draft only keeps the subscriber-timezone mode when it has a
  // time for each subscriber to receive it at.
  if (
    source === 'parent_sub_timezone' &&
    (out.status === 'schedule' || (out.status === 'draft' && out.schedule_date !== undefined))
  ) {
    out.send_in_subscribers_timezone = true;
  }

  const recurring = raw.sche_options;
  if (recurring && typeof recurring === 'object') {
    const o = recurring as Record<string, unknown>;
    const days = Array.isArray(o.schedule_days)
      ? o.schedule_days.filter((d): d is string => typeof d === 'string')
      : [];
    const times = Array.isArray(o.schedule_time)
      ? o.schedule_time.filter((t): t is string => typeof t === 'string')
      : [];
    const startDate = str(o.schedule_start_date);
    const endDate = str(o.schedule_end_date);
    if (days.length > 0 && times.length > 0 && startDate && endDate) {
      out.recurring_schedule = { days, times, start_date: startDate, end_date: endDate };
      // A recurrence is written as a normal send carrying `sche_options`, and the schema forbids
      // `schedule_date` next to it. But a recurring DRAFT must stay a draft: forcing 'sent' here
      // meant editing the title of an unstarted recurring draft sent it with `action=sent` and
      // started the recurrence — raised in review of PR #290.
      out.status = status === 'draft' ? 'draft' : 'sent';
      out.schedule_date = undefined;
    }
  }

  if (raw.android_push && typeof raw.android_push === 'object') out.android_push = raw.android_push;
  if (raw.ios_push && typeof raw.ios_push === 'object') out.ios_push = raw.ios_push;
  // Carried back even though no tool input can set it: the API rebuilds `execution_state` from
  // these on every update, so dropping it wipes the notification's mobile push settings
  // (review of PR #290).
  if (raw.mobile_push && typeof raw.mobile_push === 'object') out.mobile_push = raw.mobile_push;
  if (raw.execution_state && typeof raw.execution_state === 'object') {
    out.execution_state = raw.execution_state;
  }
  // A boolean-number the validator defaults to 1; `0` is meaningful and must not be dropped.
  if (raw.interaction !== undefined && raw.interaction !== null) out.interaction = raw.interaction;
  if (raw.require_interaction !== undefined && raw.require_interaction !== null) {
    out.interaction = raw.require_interaction;
  }

  // Keep where the notification came from, so editing one made in the dashboard, Zapier or
  // WordPress does not relabel it `API`. The delivery-mode sources are deliberately not replayed:
  // `toApiBody` derives those from the input, and a stale one would override the caller's intent.
  if (PRESERVABLE_SOURCES.includes(source) || source.toLowerCase().startsWith('wordpress')) {
    out.source = source.toLowerCase().startsWith('wordpress') ? 'wordpress' : source;
  }

  return out;
}

/**
 * The API requires a recurrence's start date to still be in the future
 * (`app/Validators/Dashboard/Controllers/Notification/index.js:110` compares end-of-day on
 * `schedule_start_date` against now), and a recurrence that is already running has a start date in
 * the past by definition. So replaying one unchanged — which is what an edit does for every field
 * the caller did not mention — is rejected, with a message about the start date that makes no
 * sense to someone who only changed a title.
 *
 * Returns the explanation to give instead, or null when there is no problem.
 *
 * `today` is passed in rather than read from the clock, and must be today's date in the SITE's
 * timezone — that is the calendar the API judges this against, and a UTC date disagrees with it
 * for up to a day at either end. An earlier version compared against a UTC date with a day of
 * slack, which let a recurrence that started YESTERDAY through to the API and so produced exactly
 * the raw validation error this exists to prevent (QA F2 on PR #290). The caller resolves the
 * site's date; see `recurringReplayIssue` in tools.ts for the fallback when it cannot be read.
 */
export function recurringStartDateIssue(
  startDate: string | undefined,
  callerSetRecurrence: boolean,
  today: string,
): string | null {
  if (callerSetRecurrence || startDate === undefined) return null;
  // The API accepts end-of-day on the start date, so TODAY is still in the future to it.
  if (startDate >= today) return null;
  return (
    `This recurring notification started on ${startDate}, and the API will not accept an update ` +
    'whose start date is in the past. Pass recurring_schedule with a start_date of today or later ' +
    '(along with the days, times and end_date you want) to change it.'
  );
}

/** What an update actually saved as its audience, and anything the API dropped on the way. */
export type SavedAudience = {
  /** A phrase to report to the user: "all subscribers", "audience groups: 1, 2", "custom filter". */
  audience: string;
  /**
   * Set only when audience groups were asked for and NONE of them survived — the send then goes
   * to every subscriber, which is the one case worth telling the user about unprompted.
   */
  dropped_audience_groups?: number[];
};

/**
 * Describe the audience an update saved, from the API's own answer rather than from the request.
 *
 * `PATCH` replies with the notification as it now stands, transformed exactly as a read is
 * (app/Services/Dashboard/Notification/index.js:570-590), so its `notification_criteria` is the
 * authority — and it is NOT always what was sent. `formatAudienceGroup`
 * (app/Helpers/NotificationFormatter.js:31-36) returns `{}` when none of the audience-group ids
 * still exist, so the stored criteria comes back empty and the notification goes to everyone.
 * That widening is accepted behaviour, but reporting the groups that were asked for would hide it.
 *
 * Reading the request's shape instead is what the response used to do — it reported the KEY of
 * `notification_criteria` (`"audience"`, `"filter"`), which told the user nothing and was wrong
 * about the deleted-group case (QA F1 on PR #290).
 *
 * `timezone` and `tz_scheduled_time` ride in the same object on a subscriber-timezone send
 * (app/Helpers/NotificationTransformer.js:355-363) and are not targeting, so they are ignored.
 *
 * A PARTIAL loss is deliberately not claimed: `formatAudienceGroup` echoes back every id it was
 * given as long as at least one resolves, so the response cannot distinguish "all three kept" from
 * "one kept, two gone" without listing the site's audience groups. Only the total loss — the one
 * that changes who receives the push — is detectable here.
 */
export function describeSavedAudience(
  savedCriteria: unknown,
  requestedGroups: number[] | undefined,
): SavedAudience {
  const criteria =
    savedCriteria && typeof savedCriteria === 'object' && !Array.isArray(savedCriteria)
      ? (savedCriteria as Record<string, unknown>)
      : undefined;

  // No criteria in the response at all: fall back to what was sent, which at least cannot claim a
  // loss that did not happen.
  if (criteria === undefined) {
    if (requestedGroups && requestedGroups.length > 0) {
      return { audience: `audience groups: ${requestedGroups.join(', ')}` };
    }
    return { audience: 'all subscribers' };
  }

  const audience =
    criteria.audience && typeof criteria.audience === 'object'
      ? (criteria.audience as Record<string, unknown>)
      : undefined;
  const savedGroups = Array.isArray(audience?.groups)
    ? audience.groups.map((g) => num(g)).filter((g): g is number => g !== undefined)
    : [];
  if (savedGroups.length > 0) {
    return { audience: `audience groups: ${savedGroups.join(', ')}` };
  }

  if (criteria.filter && typeof criteria.filter === 'object') {
    return { audience: 'custom audience filter' };
  }

  const dropped = requestedGroups && requestedGroups.length > 0 ? requestedGroups : undefined;
  return dropped
    ? {
        audience: `all subscribers — audience group ${dropped.join(', ')} no longer exists on this site, so the API dropped the targeting`,
        dropped_audience_groups: dropped,
      }
    : { audience: 'all subscribers' };
}

export const __testing__ = { toInputStatus, toActions, cleanFilter, EDITABLE_STATUSES };

/**
 * Why a notification cannot be deleted. Mirrors `deleteNotification`
 * (app/Services/Dashboard/Notification/index.js:819-873), which takes the same status set as an
 * edit but, unlike an edit, DOES handle A/B (it deletes the whole pair).
 */
export function whyNotDeletable(raw: Record<string, unknown>): string | null {
  const status = typeof raw.status === 'string' ? raw.status : '';
  const source = typeof raw.source === 'string' ? raw.source : '';

  if (source === 'rss_feed') {
    return 'RSS auto-push notifications cannot be deleted; the API refuses them. Remove or pause the RSS campaign instead.';
  }
  // 'A' is fine: the controller routes it to deleteAbNotification, which removes the pair.
  if (source !== 'A') {
    const unsupported = unsupportedSource(source, 'delete');
    if (unsupported) return unsupported;
  }
  if (!EDITABLE_STATUSES.includes(status)) {
    if (status === 'sent' || status === 'sending') {
      return source === 'parent_sub_timezone'
        ? 'This subscriber-timezone broadcast is already under way, so it cannot be deleted. Use "Cancel Scheduled" in the dashboard to stop the timezones that have not gone out yet.'
        : 'A notification that has already been sent cannot be deleted — the delivery record is kept. It can be hidden from the dashboard only by archiving.';
    }
    return `A notification with status "${status || '(unknown)'}" cannot be deleted. Only drafts, scheduled and recurring notifications can.`;
  }
  return null;
}

/**
 * Why a notification cannot be resent. The mirror image of editing: resend requires a notification
 * that HAS gone out (`status` sent or sending), and refuses subscriber-timezone parents
 * (NotificationController.js:583).
 */
export function whyNotResendable(raw: Record<string, unknown>): string | null {
  const status = typeof raw.status === 'string' ? raw.status : '';
  const source = typeof raw.source === 'string' ? raw.source : '';

  if (source === 'parent_sub_timezone') {
    return 'A subscriber-timezone notification cannot be resent; the API refuses it. Send a new one with send_in_subscribers_timezone instead.';
  }
  if (source !== 'A') {
    const unsupported = unsupportedSource(source, 'resend');
    if (unsupported) return unsupported;
  }
  if (status !== 'sent' && status !== 'sending') {
    return `Only a notification that has already been sent can be resent, and this one is "${status || '(unknown)'}". To send a draft or scheduled notification now, use pushengage_update_notification with status="sent".`;
  }
  return null;
}

/**
 * Drop the parts of a reconstructed notification that the caller's own changes have made
 * contradictory, so the merged payload can satisfy the create schema's cross-field rules.
 *
 * Those rules are strict and deliberately so: `schedule_date` is valid ONLY with
 * `status: "schedule"`, `send_in_subscribers_timezone` likewise, and `recurring_schedule` forbids
 * all three. Replaying a notification as-is satisfies them, because that is how it was created —
 * but the moment a caller changes the status or the recurrence, what was replayed no longer fits.
 * "Send this scheduled notification now" (`status: "sent"`) would otherwise fail validation on the
 * old `schedule_date`, which the caller never mentioned and cannot be expected to clear. Raised in
 * review of PR #290.
 *
 * Only fields the caller did NOT set are dropped; anything they passed is left exactly as given.
 */
export function dropConflictingSchedule(
  base: ReconstructedSendInput,
  overrides: Partial<ReconstructedSendInput>,
): ReconstructedSendInput {
  const out = { ...base };
  const callerSet = (k: keyof ReconstructedSendInput) => overrides[k] !== undefined;
  const status = callerSet('status') ? overrides.status : base.status;
  const recurring = callerSet('recurring_schedule')
    ? overrides.recurring_schedule
    : base.recurring_schedule;

  if (recurring) {
    // A recurrence carries its own timing; the one-shot fields cannot travel with it.
    if (!callerSet('schedule_date')) out.schedule_date = undefined;
    if (!callerSet('send_in_subscribers_timezone')) out.send_in_subscribers_timezone = undefined;
    // ...and the schema forbids status="schedule" beside a recurrence, so a notification that was
    // scheduled becomes a plain send carrying the recurrence. A draft stays a draft.
    if (!callerSet('status') && base.status === 'schedule') out.status = 'sent';
  }
  // Only `sent` forbids them. A DRAFT may keep both: that is how a draft of a scheduled or
  // subscriber-timezone send stores its time, and clearing it here silently undid that — the
  // unit tests missed it because they exercised this function and the reconstruction separately,
  // never the pipeline the tool actually runs.
  if (status === 'sent') {
    if (!callerSet('schedule_date')) out.schedule_date = undefined;
    if (!callerSet('send_in_subscribers_timezone')) out.send_in_subscribers_timezone = undefined;
  }
  if (status === 'schedule' && callerSet('status') && !callerSet('schedule_date')) {
    // Moving something to "schedule" without saying when. The replayed date may be the one it
    // already had, which is fine, but if there is none the schema asks for it by name.
    out.schedule_date = base.schedule_date;
  }
  return out;
}

/**
 * Put back the fields that are replayed rather than input.
 *
 * `SendNotificationInputSchema.parse` strips unknown keys, so neither `source` nor `mobile_push`
 * survives it — an earlier attempt to carry them through `toApiBody` silently did nothing, which a
 * test caught only once the source case was asserted end to end. They are applied to the finished
 * body instead.
 *
 * `source` is only restored when `toApiBody` settled on the default `API`: the delivery modes
 * (`repeat_scheduled`, `parent_sub_timezone`) are carried by that same field and must win, or a
 * stale read would override the mode the caller asked for.
 */
export function applyReplayedFields<
  T extends {
    source: string;
    mobile_push?: unknown;
    execution_state?: unknown;
    interaction?: unknown;
  },
>(body: T, replayed: ReconstructedSendInput): T {
  if (replayed.mobile_push !== undefined) body.mobile_push = replayed.mobile_push;
  // Only when the body has not built one itself: an intelligent A/B send constructs its own
  // execution_state from the input, and that must win over a replayed one.
  if (replayed.execution_state !== undefined && body.execution_state === undefined) {
    body.execution_state = replayed.execution_state;
  }
  if (replayed.interaction !== undefined) body.interaction = replayed.interaction;
  if (replayed.source !== undefined && body.source === 'API') {
    (body as { source: string }).source = replayed.source;
  }
  return body;
}
