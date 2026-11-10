// src/subscriberFilter/schema.ts
//
// The subscriber-filter expression shared by audience groups and by the send tools'
// custom-audience targeting. One source of truth for the field enum, the operator enum,
// and — new here — the per-field operator matrix the dashboard enforces.
//
// Why the matrix exists: the dashboard never lets a user pick an operator a field does not
// support. `getPredicateOperatorOptionsForField` in the dashboard
// (src/components/audiences/audienceHelper.ts) narrows the dropdown per field, so a rule like
// `{ field: 'country', op: 'eq' }` is not reachable through the UI at all. The API's Joi
// validator is looser and accepts it, and nothing downstream rejects it either — the predicate
// simply matches nobody, or (for `segments`) gets dropped and silently widens the audience.
// The API team hit the same problem on their own LLM-facing surface and solved it the same way
// (app/Services/Dashboard/OnboardingAi/filterVocabulary.js caps `segments` to in/all/nin), after
// measuring that documenting the constraint in prose did not hold.

import { z } from 'zod';

import { isCallerTimeZone, isPosixSignedZone, parseWallClock } from '../datetime/timezone';

export const MAX_GROUPS_IN_FILTER = 15;
export const MAX_RULES_PER_GROUP = 50;

/**
 * Fields a rule can match against. Mirrors the dashboard's rule-builder dropdown
 * (`advancedFilterFieldOptions`) one-for-one.
 *
 * Deliberately NOT included: the singular `segment`. It appears only in the API's
 * display-label map (`SUBR_FIELD_VIEW`); every piece of criteria logic tests
 * `rule.field === 'segments'` exactly, so a singular rule bypasses the server-side segment
 * scrubbing entirely and may be ignored by the delivery engine — which widens the audience
 * instead of narrowing it. See docs/KNOWLEDGE.md.
 */
export const SubscriberFieldEnum = z.enum([
  'attributes',
  'city',
  'click_count',
  'country',
  'device',
  'device_token_hash',
  'device_type',
  'profile_id',
  'segments',
  'sent_count',
  'state',
  'ts_created',
  'ts_last_click',
  'ts_last_sent',
  'ts_last_view',
  'view_count',
]);

export type SubscriberField = z.infer<typeof SubscriberFieldEnum>;

export const SubscriberOpEnum = z.enum([
  'all',
  'dt_gt',
  'dt_lt',
  'eq',
  'exists',
  'gt',
  'gte',
  'in',
  'lt',
  'lte',
  'ne',
  'nin',
  'not_exists',
  'ts_elapsed_gt',
  'ts_elapsed_lt',
]);

export type SubscriberOp = z.infer<typeof SubscriberOpEnum>;

/**
 * Which operators each field actually supports, lifted from the dashboard's
 * `getPredicateOperatorOptionsForField`. `attributes` is the dashboard's `default` branch and
 * is the only field that accepts the full set.
 */
export const FIELD_OPS: Record<SubscriberField, readonly SubscriberOp[]> = {
  // Closed-vocabulary fields: pick from a list, or exclude a list. Nothing else is meaningful.
  city: ['in', 'nin'],
  country: ['in', 'nin'],
  state: ['in', 'nin'],
  device: ['in', 'nin'],
  device_type: ['in', 'nin'],

  // Segments additionally support "is all of" (member of every listed segment).
  segments: ['in', 'all', 'nin'],

  // Engagement counters are plain numeric comparisons.
  click_count: ['eq', 'lt', 'gt', 'lte', 'gte'],
  sent_count: ['eq', 'lt', 'gt', 'lte', 'gte'],
  view_count: ['eq', 'lt', 'gt', 'lte', 'gte'],

  // Date fields: absolute (lt = before, gt = after) or relative
  // (ts_elapsed_lt = "in the last N MINUTES", ts_elapsed_gt = "older than N MINUTES").
  // See ELAPSED_OPS below for why minutes and not seconds.
  ts_created: ['lt', 'gt', 'ts_elapsed_lt', 'ts_elapsed_gt'],
  ts_last_click: ['lt', 'gt', 'ts_elapsed_lt', 'ts_elapsed_gt'],
  ts_last_sent: ['lt', 'gt', 'ts_elapsed_lt', 'ts_elapsed_gt'],
  ts_last_view: ['lt', 'gt', 'ts_elapsed_lt', 'ts_elapsed_gt'],

  // Identity lookups are membership-only in the dashboard.
  device_token_hash: ['in'],
  profile_id: ['in'],

  // Custom attributes: the dashboard's catch-all branch, everything is on the table.
  attributes: [
    'eq',
    'ne',
    'gt',
    'gte',
    'lt',
    'lte',
    'in',
    'nin',
    'dt_lt',
    'dt_gt',
    'ts_elapsed_lt',
    'ts_elapsed_gt',
    'exists',
    'not_exists',
  ],
};

/** Ops that take no `value` at all. */
export const VALUELESS_OPS: readonly SubscriberOp[] = ['exists', 'not_exists'];

/** Ops whose `value` must be an array. */
export const ARRAY_OPS: readonly SubscriberOp[] = ['in', 'nin', 'all'];

/**
 * Ops whose `value` is a count of MINUTES.
 *
 * Not seconds. Getting this wrong is a 60x targeting error, so here is the evidence:
 *
 * - Delivery engine: `pushengage-node` `pe-modules/criteria-parser/mongo-parser.js` builds the
 *   cutoff as `baseTime - filter.value * 60000`, and `evaluator.js` carries the comment
 *   "predicate.value is in minutes, so multiply by 60000".
 * - Dashboard write path: `AdvanceAudienceTimeElapsedInput.tsx` offers Minutes / Hours / Days
 *   and sends `value * 60 * 24` for days, `value * 60` for hours, bare for minutes.
 * - Dashboard read path: `AudienceFilterPreview.tsx` renders with `formatTimeElapsed(minutes)`.
 * - QA confirmed it live on PR #287: a browser 386 seconds old matched
 *   `ts_created ts_elapsed_lt 60`, which only happens if 60 means 60 minutes.
 *
 * The API's Joi validator accepts any positive integer, so a seconds value is not rejected --
 * it silently targets 60x the intended window. The MCP shipped 1.1.0 claiming seconds; that
 * claim was wrong, and `create_audience_group` carried it from 1.0.0.
 */
export const ELAPSED_OPS: readonly SubscriberOp[] = ['ts_elapsed_gt', 'ts_elapsed_lt'];

/** Minutes in a day — the multiplier for turning "N days" into an elapsed value. */
export const MINUTES_PER_DAY = 1440;

/**
 * Closed value vocabularies, hardcoded in the dashboard rather than fetched
 * (`deviceOptions` / `deviceTypeOptions`). Geo values are NOT closed — they come from the
 * site's own subscriber data, which is what `pushengage_list_audience_filter_values` is for.
 */
export const DEVICE_VALUES = ['mobile', 'tablet', 'desktop', 'unknown'] as const;

export const DEVICE_TYPE_VALUES = [
  'chrome',
  'opera',
  'firefox',
  'safari',
  'edge',
  'samsung',
  'yandex',
  'android',
  'ios',
  'unknown',
] as const;

/**
 * Mirrors the API's attribute-key rules. The filter validator's own regex is looser
 * (`^[a-zA-Z\d-_]+$`, digits allowed first), but a filter key has to name an attribute that
 * already exists, and attribute creation enforces the stricter form
 * (`app/Validators/Dashboard/Schema/SubscriberAttribute.js`), so a key that fails this could
 * never have been created. Same constants as src/attributes/schema.ts.
 */
const ATTRIBUTE_KEY_REGEX = /^[A-Za-z][A-Za-z0-9_-]*$/;
const MAX_ATTRIBUTE_KEY_LENGTH = 64;

/** ISO 8601, as `Joi.date().iso()` accepts for the dt_* operators. */
const ISO_DATE_REGEX =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * The absolute-date forms the API accepts on a ts_* field with a comparison operator:
 * `YYYY-MM-DD HH:mm:ss`, `YYYY-MM-DD hh:mm A`, or ISO 8601 (app/Validators/Helper.js).
 */
const API_DATETIME_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const API_DATE_12H_REGEX = /^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2} ?[AaPp][Mm]$/;

/** ts_* fields hold timestamps; their absolute comparisons take a date, not a bare number. */
export const TIMESTAMP_FIELDS: readonly SubscriberField[] = [
  'ts_created',
  'ts_last_click',
  'ts_last_sent',
  'ts_last_view',
];

/** Already-unambiguous values: a trailing `Z` or an explicit `±HH:MM` offset. */
export const HAS_EXPLICIT_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/;

/** A date with no time of day. Valid on its own; just not something a timezone can shift. */
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** The comparison operators that read a ts_* field as an absolute moment rather than a number. */
const DATE_COMPARISON_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'];

/** True when this rule compares against an absolute date rather than a scalar or a duration. */
export function isDateRule(rule: { field: string; op: string }): boolean {
  if (rule.op === 'dt_gt' || rule.op === 'dt_lt') return true;
  return (
    TIMESTAMP_FIELDS.includes(rule.field as SubscriberField) &&
    DATE_COMPARISON_OPS.includes(rule.op)
  );
}

/**
 * True when a `timezone` on the filter would actually change this rule's value.
 *
 * The single definition of "convertible", shared by the schema's validation and `dates.ts`'s
 * conversion so the two can never disagree. They did: validation only asked whether SOME date
 * rule held a string, so a filter whose values were all date-only, all 12-hour, all
 * fractional-second or all explicitly offset passed validation, converted nothing, and reported
 * nothing — the caller's timezone silently did nothing (review of PR #287). The first three now
 * convert; a value that states its own offset still needs no conversion, and a filter made only
 * of those is rejected rather than quietly ignored.
 */
export function isConvertibleDateValue(rule: {
  field: string;
  op: string;
  value?: string | number | boolean | Array<string | number | boolean>;
}): boolean {
  if (typeof rule.value !== 'string') return false;
  if (!isDateRule(rule)) return false;
  if (HAS_EXPLICIT_OFFSET.test(rule.value.trim())) return false;
  return parseWallClock(rule.value) !== null;
}

const RuleValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])).min(1),
]);

/**
 * One predicate. The field/op pairing and the value's shape are both checked here, so a
 * malformed rule fails at the MCP boundary with a message naming the field — rather than
 * reaching the API, validating, saving, and matching nobody.
 */
export const SubscriberRuleSchema = z
  .object({
    field: SubscriberFieldEnum.describe(
      'Which subscriber property to match. Each field accepts only certain operators — see `op`.',
    ),
    op: SubscriberOpEnum.describe(
      'Comparison operator. Allowed values depend on `field`: ' +
        'country/state/city/device/device_type → in, nin. ' +
        'segments → in (any of), all (all of), nin (none of). ' +
        'sent_count/view_count/click_count → eq, lt, gt, lte, gte. ' +
        'ts_created/ts_last_sent/ts_last_view/ts_last_click → lt (before), gt (after), ' +
        'ts_elapsed_lt (in the last N minutes), ts_elapsed_gt (older than N minutes). ' +
        'profile_id/device_token_hash → in. ' +
        'attributes → any operator, including exists / not_exists.',
    ),
    value: RuleValueSchema.optional().describe(
      'The match value. Omit entirely for exists / not_exists. Array for in / nin / all. ' +
        'Positive integer number of MINUTES for ts_elapsed_gt / ts_elapsed_lt — 60 = one hour, ' +
        '1440 = one day, 10080 = seven days. Multiply days by 1440. ' +
        'For segments, pass segment NAMES as strings (resolved automatically) or numeric segment IDs.',
    ),
    key: z
      .string()
      .trim()
      .min(1)
      .max(MAX_ATTRIBUTE_KEY_LENGTH)
      .regex(
        ATTRIBUTE_KEY_REGEX,
        'key must start with a letter and contain only letters, numbers, hyphens, and underscores',
      )
      .optional()
      .describe(
        'Required ONLY when field="attributes" — the attribute key to look up. ' +
          'Call pushengage_list_attributes to discover valid keys. Must be omitted for every other field.',
      ),
  })
  .superRefine((rule, ctx) => {
    const allowed = FIELD_OPS[rule.field];
    if (allowed && !allowed.includes(rule.op)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['op'],
        message:
          `op="${rule.op}" is not supported for field="${rule.field}". ` +
          `Supported: ${allowed.join(', ')}.`,
      });
    }

    if (rule.field === 'attributes' && !rule.key) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['key'],
        message: 'key is required when field="attributes" — name the custom attribute to look up',
      });
    }
    // The dashboard strips `key` for every non-attribute field before submitting
    // (`formatAdvancedAudienceFilter`). Reject rather than silently strip, so the caller
    // learns the rule was not doing what they thought.
    if (rule.field !== 'attributes' && rule.key !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['key'],
        message: `key is only valid when field="attributes" (got field="${rule.field}")`,
      });
    }

    const needsValue = !VALUELESS_OPS.includes(rule.op);
    if (needsValue && rule.value === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `value is required for op="${rule.op}" (only exists/not_exists may omit it)`,
      });
    }
    if (!needsValue && rule.value !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `value must be omitted for op="${rule.op}"`,
      });
    }

    if (ARRAY_OPS.includes(rule.op) && rule.value !== undefined && !Array.isArray(rule.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `value must be an array for op="${rule.op}"`,
      });
    }
    if (!ARRAY_OPS.includes(rule.op) && Array.isArray(rule.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `value must be a single value for op="${rule.op}" (arrays are only for in/nin/all)`,
      });
    }

    if (ELAPSED_OPS.includes(rule.op)) {
      const v = rule.value;
      if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['value'],
          message:
            `value must be a positive integer number of MINUTES for op="${rule.op}" ` +
            '(60 = one hour, 1440 = one day, 10080 = seven days). Multiply days by 1440.',
        });
      }
    }

    // Absolute date comparisons. The API types these per field+op and 422s on anything else;
    // checking here turns a wasted round-trip into an actionable message.
    if (
      TIMESTAMP_FIELDS.includes(rule.field) &&
      ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'].includes(rule.op) &&
      rule.value !== undefined
    ) {
      const v = rule.value;
      const ok =
        typeof v === 'string' &&
        (API_DATETIME_REGEX.test(v) || API_DATE_12H_REGEX.test(v) || ISO_DATE_REGEX.test(v));
      if (!ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['value'],
          message:
            `field="${rule.field}" with op="${rule.op}" compares against a date. Use ` +
            '"YYYY-MM-DD HH:mm:ss" or ISO 8601. For a relative window use ts_elapsed_lt / ' +
            'ts_elapsed_gt with a number of minutes instead.',
        });
      }
    }

    if ((rule.op === 'dt_gt' || rule.op === 'dt_lt') && rule.value !== undefined) {
      if (typeof rule.value !== 'string' || !ISO_DATE_REGEX.test(rule.value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['value'],
          message: `op="${rule.op}" requires an ISO 8601 date, e.g. "2026-11-05" or "2026-11-05T09:00:00Z".`,
        });
      }
    }

    // Closed vocabularies. Geo values are intentionally not checked here — they are
    // site-specific; use pushengage_list_audience_filter_values to discover them.
    if (rule.field === 'device' && Array.isArray(rule.value)) {
      for (const v of rule.value) {
        if (!DEVICE_VALUES.includes(v as (typeof DEVICE_VALUES)[number])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['value'],
            message: `"${String(v)}" is not a valid device. Valid: ${DEVICE_VALUES.join(', ')}.`,
          });
        }
      }
    }
    if (rule.field === 'device_type' && Array.isArray(rule.value)) {
      for (const v of rule.value) {
        if (!DEVICE_TYPE_VALUES.includes(v as (typeof DEVICE_TYPE_VALUES)[number])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['value'],
            message: `"${String(v)}" is not a valid browser/platform. Valid: ${DEVICE_TYPE_VALUES.join(', ')}.`,
          });
        }
      }
    }
  });

export type SubscriberRule = z.infer<typeof SubscriberRuleSchema>;

export const SubscriberFilterSchema = z
  .object({
    timezone: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "OPTIONAL. The IANA timezone that this filter's DATE values are written in, e.g. " +
          '"Asia/Kolkata". Applies to absolute comparisons on ts_created / ts_last_sent / ' +
          'ts_last_click / ts_last_view, and to dt_gt / dt_lt on attributes. ' +
          'Date values in a filter are interpreted as UTC by default, so set this whenever the user ' +
          'gives a date in their own timezone ("subscribed after 1 January my time") — the values are ' +
          'converted to UTC before sending and the response reports what was converted. ' +
          'It does NOT affect ts_elapsed_gt / ts_elapsed_lt, which are durations in minutes and carry ' +
          'no timezone. Use a full zone name; abbreviations like IST or PST are rejected. ' +
          'Note this is unrelated to `schedule_timezone`, which concerns WHEN the notification is ' +
          "sent and is interpreted against the site's timezone rather than UTC.",
      ),
    op: z
      .enum(['or'], {
        // A bare enum error reads "Invalid enum value. Expected 'or', received 'and'", which does
        // not tell the caller what to do instead. `and` is the one value worth explaining, since
        // the API accepts it and earlier versions of this schema offered it.
        errorMap: (issue, ctx) =>
          issue.code === z.ZodIssueCode.invalid_enum_value && issue.received === 'and'
            ? {
                message:
                  'op="and" is not supported. The dashboard cannot represent an AND across groups: ' +
                  'its preview always prints OR between them, and saving an audience there writes no ' +
                  'op at all, so an edit would silently change what the filter means. Rules inside a ' +
                  'single group are already AND-ed — put the conditions in one group instead.',
              }
            : { message: ctx.defaultError },
      })
      .default('or')
      .describe(
        'How groups in `value` combine. Only "or" is supported: a subscriber matches if ANY group ' +
          'matches. Rules WITHIN a group are always AND-ed, so use one group to require several ' +
          'conditions together. To AND across groups, create the audience in the dashboard instead.',
      ),
    value: z
      .array(z.array(SubscriberRuleSchema).min(1).max(MAX_RULES_PER_GROUP))
      .min(1)
      .max(MAX_GROUPS_IN_FILTER)
      .describe(
        `2-D array: outer is a list of rule-groups (max ${MAX_GROUPS_IN_FILTER}), each inner group ` +
          `is an AND-ed list of rules (1–${MAX_RULES_PER_GROUP}). With the default op="or", a ` +
          `subscriber matches if any group's rules all match.`,
      ),
  })
  .superRefine((filter, ctx) => {
    const tz = (filter as { timezone?: string }).timezone;
    if (tz === undefined) return;
    if (isPosixSignedZone(tz)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timezone'],
        message:
          `"${tz}" means the opposite of what it reads like: the Etc/GMT±N zones use the POSIX ` +
          `sign convention, so "${tz}" is ${tz.trim().charAt(7) === '+' ? 'BEHIND' : 'AHEAD OF'} ` +
          'UTC. Name the place instead — "Asia/Kolkata", "America/New_York" — which cannot be read ' +
          'backwards.',
      });
    } else if (!isCallerTimeZone(tz)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timezone'],
        message:
          `"${tz}" is not a recognised IANA timezone. Use a full zone name such as "Asia/Kolkata" ` +
          'or "America/New_York" — abbreviations like IST or PST are ambiguous and carry no ' +
          'daylight-saving rule.',
      });
    }
    // A timezone that would change nothing is a sign the rule was built wrong — most likely
    // ts_elapsed_* (a duration) was used where an absolute date was meant, or every value already
    // states its own offset. Either way, saying so beats accepting a setting that does nothing.
    const convertible = filter.value.some((group) => group.some(isConvertibleDateValue));
    if (!convertible) {
      const dateValues = filter.value
        .flat()
        .filter((rule) => typeof rule.value === 'string' && isDateRule(rule))
        .map((rule) => (rule.value as string).trim());
      const explicitlyOffset = dateValues.some((v) => HAS_EXPLICIT_OFFSET.test(v));
      // A date with no time of day is a real date value, so "nothing to apply it to" would be a
      // confusing thing to tell the caller. It is not converted on purpose (see
      // `convertFilterDatesToUtc`), so the fix is to give a time of day.
      const dateOnly = dateValues.some((v) => DATE_ONLY_REGEX.test(v));
      let message: string;
      if (explicitlyOffset) {
        message =
          'timezone would change nothing: every date value here already states its own offset ' +
          '(a trailing Z or ±HH:MM), which always wins. Drop timezone, or give the dates as ' +
          'plain "YYYY-MM-DD HH:mm:ss" in that zone.';
      } else if (dateOnly) {
        message =
          'timezone cannot be applied to a date with no time of day, because the time of day is ' +
          'what it would shift. Give the value as "YYYY-MM-DD HH:mm:ss" (use 00:00:00 for the ' +
          'start of the day), or drop timezone and the date is read as UTC.';
      } else {
        message =
          'timezone has no date value to apply to. It affects absolute comparisons on ts_created / ' +
          'ts_last_sent / ts_last_click / ts_last_view and dt_gt / dt_lt only. ' +
          'ts_elapsed_gt / ts_elapsed_lt are durations in minutes and need no timezone — drop it.';
      }
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['timezone'], message });
    }
  });

export type SubscriberFilter = z.infer<typeof SubscriberFilterSchema>;

/** True when any rule in the filter targets segments — i.e. resolution is needed. */
export function hasSegmentRule(filter: SubscriberFilter): boolean {
  return filter.value.some((group) => group.some((rule) => rule.field === 'segments'));
}

/** Distinct attribute keys referenced by the filter, for verification against the site. */
export function attributeKeysIn(filter: SubscriberFilter): string[] {
  const keys = new Set<string>();
  for (const group of filter.value) {
    for (const rule of group) {
      if (rule.field === 'attributes' && rule.key) keys.add(rule.key);
    }
  }
  return [...keys];
}
