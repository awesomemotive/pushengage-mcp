// src/segments/schema.ts
import { z } from 'zod';

// Limits mirror the API's segment validator.
const MAX_SEGMENT_NAME_LENGTH = 150;
const MAX_URL_VALUE_LENGTH = 2048; // matches textLimit.max.url
const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 100;

/**
 * URL-rule match modes accepted by the API. The API constants are exactly these strings
 * (note: 'contains' is plural — historical naming in the dashboard).
 */
const RULE_VALUES = ['start', 'exact', 'contains'] as const;

const SegmentRuleSchema = z.object({
  rule: z
    .enum(RULE_VALUES)
    .describe(
      'How the URL match is evaluated: ' +
        '"start" — the subscriber\'s page URL starts with `value`; ' +
        '"exact" — the URL exactly equals `value`; ' +
        '"contains" — the URL contains `value`.',
    ),
  value: z
    .string()
    .trim()
    .min(1)
    .max(MAX_URL_VALUE_LENGTH)
    .describe('The URL or URL fragment to match against, per the chosen rule.'),
});

const SegmentCriteriaSchema = z
  .object({
    include: z
      .array(SegmentRuleSchema)
      .optional()
      .describe('URL rules whose match adds a subscriber to this segment. May be empty.'),
    exclude: z
      .array(SegmentRuleSchema)
      .optional()
      .describe(
        'URL rules whose match removes (or prevents adding) a subscriber from this segment. May be empty.',
      ),
  })
  .refine((c) => c.include || c.exclude, {
    message: 'segment_criteria must include at least one of `include` or `exclude` rules',
  });

// ---- pushengage_list_segments ---------------------------------------------------------

export const ListSegmentsInputSchema = z.object({
  site_id: z.number().int().positive().optional().describe('Override the currently selected site.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_LIMIT)
    .default(DEFAULT_LIST_LIMIT)
    .describe(
      `How many segments to return in this page. Min 1, max ${MAX_LIST_LIMIT}, default ${DEFAULT_LIST_LIMIT}. ` +
        `To browse past the first ${MAX_LIST_LIMIT}, increase \`page\` instead of asking for a larger limit.`,
    ),
  page: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe(
      'Page number (1-indexed) for paginating beyond the first batch. ' +
        'e.g. with limit=100 the second page (segments 101–200) is page=2.',
    ),
  name_contains: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Optional case-insensitive substring filter on segment_name.'),
});

export type ListSegmentsInput = z.infer<typeof ListSegmentsInputSchema>;

// ---- pushengage_create_segment --------------------------------------------------------

export const CreateSegmentInputSchema = z.object({
  segment_name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_SEGMENT_NAME_LENGTH)
    .describe(`Segment display name. 1–${MAX_SEGMENT_NAME_LENGTH} characters.`),
  segment_criteria: SegmentCriteriaSchema.optional().describe(
    'URL-based include/exclude rules that decide which subscribers belong to this segment. ' +
      'Omit to create a name-only segment that the user populates later via the dashboard or workflows. ' +
      'When provided, at least one of `include` or `exclude` must have rules.',
  ),
  add_segment_on_page_load: z
    .boolean()
    .default(false)
    .describe(
      'Segment on Page Visit. By default (false), segment criteria (such as URL rules) are evaluated ' +
        'only when a visitor subscribes to push notifications. Set to true to evaluate those criteria on ' +
        'every page visit instead, so segment membership can change as subscribers browse your site.',
    ),
  site_id: z.number().int().positive().optional().describe('Override the currently selected site.'),
});

export type CreateSegmentInput = z.infer<typeof CreateSegmentInputSchema>;

/**
 * API body for POST /sites/:siteId/segments. Field names mirror SEGMENT_DB_COLUMN.
 * `add_segment_on_page_load` is a 0/1 number on the API side.
 */
export type ApiCreateSegmentBody = {
  segment_name: string;
  segment_criteria?: {
    include?: Array<{ rule: 'start' | 'exact' | 'contains'; value: string }>;
    exclude?: Array<{ rule: 'start' | 'exact' | 'contains'; value: string }>;
  };
  add_segment_on_page_load: 0 | 1;
};

export function toCreateSegmentApiBody(input: CreateSegmentInput): ApiCreateSegmentBody {
  const body: ApiCreateSegmentBody = {
    segment_name: input.segment_name,
    add_segment_on_page_load: input.add_segment_on_page_load ? 1 : 0,
  };
  if (input.segment_criteria) {
    const c: NonNullable<ApiCreateSegmentBody['segment_criteria']> = {};
    if (input.segment_criteria.include) c.include = input.segment_criteria.include;
    if (input.segment_criteria.exclude) c.exclude = input.segment_criteria.exclude;
    body.segment_criteria = c;
  }
  return body;
}
