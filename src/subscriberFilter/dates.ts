// src/subscriberFilter/dates.ts
//
// Custom-audience date values are UTC. `schedule_date` is SITE-local. Same request, two
// conventions — this module handles the filter half.
//
// EVIDENCE THAT FILTER DATES ARE UTC
//
// Unlike the legacy segment criteria, whose `from_date` / `to_date` the API converts with
// `moment.localToUtc(criteria.from_date, timezone)` (app/Helpers/NotificationFormatter.js:235),
// the `filter` branch converts nothing: `formatCriteriaFilter`
// (app/Helpers/Notification.js:1283) only rewrites rules whose field is `segments` and passes
// every other value through untouched. The dashboard agrees — its own picker reads stored values
// with `moment.utc(value)` and writes back a naive string
// (pushengage-app/src/components/audiences/AdvancedAudienceDatePicker.tsx:16,27).
//
// So a naive date in a filter rule is read as UTC. A user who says "subscribed after 1 Jan, my
// time" and gets a naive value sent as-is is off by their whole offset — up to 14 hours.

import {
  API_DATETIME_FORMAT,
  formatWallClock,
  offsetMinutesAt,
  formatOffset,
  parseWallClock,
  wallClockAt,
  wallClockToUtcMs,
} from '../datetime/timezone';
import type { SubscriberFilter, SubscriberRule } from './schema';
import { isConvertibleDateValue, isDateRule } from './schema';

export type FilterDateConversion = {
  field: string;
  key?: string;
  op: string;
  requested: string;
  requested_timezone: string;
  requested_utc_offset: string;
  /** What is sent to the API, in UTC. */
  send_as_utc: string;
};

export type FilterDateResult = {
  filter: SubscriberFilter;
  conversions: FilterDateConversion[];
};

/**
 * Reinterpret the filter's naive date values from `timezone` into UTC, and drop the MCP-only
 * `timezone` key so it never reaches the request body.
 *
 * `timezone` is not part of the API's `subscriberFilterSchema`. Validation runs with
 * `stripUnknown: true`, so leaving it on would be silently discarded rather than rejected —
 * which is precisely the kind of quiet no-op worth avoiding. Stripped here instead.
 *
 * Values carrying an explicit offset are left to speak for themselves; only naive ones are
 * reinterpreted. With no `timezone` set, nothing is touched and naive values keep their existing
 * UTC meaning, so this is backwards-compatible.
 */
export function convertFilterDatesToUtc(filter: SubscriberFilter): FilterDateResult {
  const { timezone, ...rest } = filter as SubscriberFilter & { timezone?: string };
  const base: SubscriberFilter = { op: rest.op, value: rest.value };

  if (!timezone) return { filter: base, conversions: [] };

  const conversions: FilterDateConversion[] = [];

  const value = base.value.map((group) =>
    group.map((rule): SubscriberRule => {
      // One shared definition of "convertible" with the schema, which rejects a `timezone` that
      // no value in the filter can use. A value that states its own offset is left to speak for
      // itself; everything else the schemas accept is parsed, including a date with no time of
      // day (read as 00:00:00 in `timezone` — the same midnight the API already reads, just in
      // the zone the caller named).
      if (!isConvertibleDateValue(rule)) return rule;

      const parsed = parseWallClock(rule.value as string);
      /* c8 ignore next -- isConvertibleDateValue already proved this parses. */
      if (!parsed) return rule;

      const instantMs = wallClockToUtcMs(parsed, timezone);
      const utc = formatWallClock(wallClockAt(instantMs, 'UTC'));

      conversions.push({
        field: rule.field,
        ...(rule.key ? { key: rule.key } : {}),
        op: rule.op,
        requested: formatWallClock(parsed),
        requested_timezone: timezone,
        requested_utc_offset: formatOffset(offsetMinutesAt(instantMs, timezone)),
        send_as_utc: utc,
      });

      return { ...rule, value: utc };
    }),
  );

  return { filter: { op: base.op, value }, conversions };
}

export const __testing__ = { isDateRule, API_DATETIME_FORMAT };
