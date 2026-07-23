// src/audienceGroups/schema.ts
import { z } from 'zod';

// Limits mirror the API's audience-group validator and the subscriber-filter schema.
const MAX_NAME_LENGTH = 150;
const MAX_DESCRIPTION_LENGTH = 256;
const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 100;
const MAX_GROUPS_IN_FILTER = 15;
const MAX_RULES_PER_GROUP = 50;

/**
 * Fields that a subscriber filter rule can match against.
 *
 * Maps roughly to the dashboard's audience-group rule builder dropdown. Use
 *   - `device` for "Device" (mobile / desktop / tablet)
 *   - `device_type` for "Browser" (chrome / firefox / android / ios / etc.)
 *   - `country` / `state` / `city` for geo
 *   - `segment` / `segments` for PushEngage segment IDs (`segment` is the API alias)
 *   - `attributes` for custom subscriber attributes — REQUIRES the `key` field on the rule
 *   - `ts_created` / `ts_last_click` / `ts_last_sent` / `ts_last_view` for date fields
 *   - `click_count` / `sent_count` / `view_count` for engagement counts
 *   - `profile_id` / `device_token_hash` for identity matching
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
  'segment',
  'segments',
  'sent_count',
  'state',
  'ts_created',
  'ts_last_click',
  'ts_last_sent',
  'ts_last_view',
  'view_count',
]);

/**
 * Operators a rule can use:
 *   - eq / ne                — equals / not equals (string|number|boolean)
 *   - gt / gte / lt / lte    — numeric (or ISO date when field is ts_*)
 *   - in / nin / all         — array operations (`value` is an array)
 *   - exists / not_exists    — presence check (no `value`)
 *   - dt_gt / dt_lt          — date comparison; `value` is an ISO date
 *   - ts_elapsed_gt / lt     — "more than / less than N seconds ago"; `value` is positive integer (seconds)
 */
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

/**
 * Value shape per rule depends on field+op (see SubscriberOpEnum docs). The Zod side
 * stays permissive — the API's Joi validator enforces the discriminated typing and
 * returns 422 with specific field errors when wrong. Forwarding raw values keeps the
 * MCP simple and the LLM doesn't have to remember a tree of conditional types.
 */
const RuleValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])).min(1),
]);

const SubscriberRuleSchema = z
  .object({
    field: SubscriberFieldEnum.describe(
      'Which subscriber attribute the rule matches against. See the field enum for the supported list.',
    ),
    op: SubscriberOpEnum.describe(
      'How to compare. Some ops (exists, not_exists) take no value; some (in/nin/all) take an array; ts_elapsed_gt/lt takes seconds.',
    ),
    value: RuleValueSchema.optional().describe(
      'The match value. Omit for exists/not_exists. Use an array for in/nin/all. Use seconds (integer) for ts_elapsed_gt/lt.',
    ),
    key: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Required ONLY when field="attributes" — the custom-attribute key to look up. Ignored otherwise.',
      ),
  })
  .superRefine((rule, ctx) => {
    if (rule.field === 'attributes' && !rule.key) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['key'],
        message: 'key is required when field="attributes" — name the custom attribute to look up',
      });
    }
    const needsValue = rule.op !== 'exists' && rule.op !== 'not_exists';
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
  });

export const SubscriberFilterSchema = z.object({
  op: z
    .enum(['or', 'and'])
    .default('or')
    .describe(
      'How groups in `value` combine: "or" (default) means a subscriber matches if ANY group matches; "and" means EVERY group must match. Rules WITHIN a group are always AND-ed together.',
    ),
  value: z
    .array(z.array(SubscriberRuleSchema).min(1).max(MAX_RULES_PER_GROUP))
    .min(1)
    .max(MAX_GROUPS_IN_FILTER)
    .describe(
      `2-D array: outer is a list of rule-groups (max ${MAX_GROUPS_IN_FILTER}), each inner group is an AND-ed list of rules (1–${MAX_RULES_PER_GROUP}). With the default top-level op="or", subscribers match the audience if any group's rules all match.`,
    ),
});

export type SubscriberFilter = z.infer<typeof SubscriberFilterSchema>;

// ---- pushengage_list_audience_groups --------------------------------------------------

export const ListAudienceGroupsInputSchema = z.object({
  site_id: z.number().int().positive().optional().describe('Override the currently selected site.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_LIMIT)
    .default(DEFAULT_LIST_LIMIT)
    .describe(
      `How many audience groups to return in this page. Min 1, max ${MAX_LIST_LIMIT}, default ${DEFAULT_LIST_LIMIT}. ` +
        `To browse past the first ${MAX_LIST_LIMIT}, increase \`page\` instead of asking for a larger limit.`,
    ),
  page: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe(
      'Page number (1-indexed) for paginating beyond the first batch. e.g. with limit=100 the second page (101–200) is page=2.',
    ),
  name_contains: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Optional substring filter on the audience-group name. Maps to API `name_like`.'),
});

export type ListAudienceGroupsInput = z.infer<typeof ListAudienceGroupsInputSchema>;

// ---- pushengage_create_audience_group -------------------------------------------------

export const CreateAudienceGroupInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_NAME_LENGTH)
    .describe(`Audience-group display name. 1–${MAX_NAME_LENGTH} chars.`),
  description: z
    .string()
    .trim()
    .max(MAX_DESCRIPTION_LENGTH)
    .optional()
    .describe(`Optional human-readable description, up to ${MAX_DESCRIPTION_LENGTH} chars.`),
  filter: SubscriberFilterSchema.describe(
    'Required. The subscriber-filter expression that decides which subscribers belong to this group. ' +
      'Use SubscriberFilterSchema: an outer op ("or"/"and") + a 2-D `value` array (groups of AND-ed rules). ' +
      'Each rule is { field, op, value?, key? }. Example — "all mobile subscribers": ' +
      '{ op: "or", value: [[{ field: "device", op: "in", value: ["mobile"] }]] }. ' +
      'Example — "subscribed in the last 7 days": ' +
      '{ op: "or", value: [[{ field: "ts_created", op: "ts_elapsed_lt", value: 604800 }]] }. ' +
      '(604800 = 7 × 24 × 3600 seconds.)',
  ),
  site_id: z.number().int().positive().optional().describe('Override the currently selected site.'),
});

export type CreateAudienceGroupInput = z.infer<typeof CreateAudienceGroupInputSchema>;

export type ApiCreateAudienceGroupBody = {
  name: string;
  description?: string;
  filter: SubscriberFilter;
};

export function toCreateAudienceGroupApiBody(
  input: CreateAudienceGroupInput,
): ApiCreateAudienceGroupBody {
  const body: ApiCreateAudienceGroupBody = {
    name: input.name,
    filter: input.filter,
  };
  if (input.description) body.description = input.description;
  return body;
}
