// src/audienceGroups/schema.ts
import { z } from 'zod';

// The subscriber-filter expression is shared with the send tools' `subscriber_filter`
// targeting, so it lives in its own module rather than here. Import it where it is needed.
import { SubscriberFilterSchema } from '../subscriberFilter/schema';
import type { SubscriberFilter } from '../subscriberFilter/schema';

// Limits mirror the API's audience-group validator. The filter's own limits live with the
// filter schema in ../subscriberFilter/schema.ts.
const MAX_NAME_LENGTH = 150;
const MAX_DESCRIPTION_LENGTH = 256;
const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 100;

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
      '{ op: "or", value: [[{ field: "ts_created", op: "ts_elapsed_lt", value: 10080 }]] }. ' +
      '(ts_elapsed_* values are MINUTES: 10080 = 7 × 24 × 60.)',
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
