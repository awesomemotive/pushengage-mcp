// src/audienceFilterValues/schema.ts
//
// Backs the value pickers in the dashboard's "Send to Custom Audience" filter builder.
//
// Naming follows the dashboard, not the endpoint. The API route is `geo-segments`, but the user
// never sees the word "geo" — they see one audience option, "Send to Custom Audience"
// ("Personalize your notification based on segments, user's geolocation, device, and more.."),
// with location and device as two fields among several. Framing this tool as a "geo" lookup would
// invent a category that does not exist in the product.
//
// Segments and attributes are the other two value vocabularies in that same builder; they already
// have their own list tools, which this tool's description points at.

import { z } from 'zod';

/**
 * The subscriber-filter fields whose values this tool can enumerate. These are exactly the
 * `field` values a rule can carry, so the input maps 1:1 onto `subscriber_filter`.
 *
 * The underlying endpoint also accepts `platform`, which is deliberately NOT offered here: it is
 * not one of the Custom Audience filter fields, so a caller who looked it up could not do anything
 * with the result.
 */
export const AUDIENCE_FILTER_VALUE_FIELDS = [
  'country',
  'state',
  'city',
  'device',
  'device_type',
] as const;

export type AudienceFilterValueField = (typeof AUDIENCE_FILTER_VALUE_FIELDS)[number];

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export const ListAudienceFilterValuesInputSchema = z.object({
  fields: z
    .array(z.enum(AUDIENCE_FILTER_VALUE_FIELDS))
    .min(1)
    .max(AUDIENCE_FILTER_VALUE_FIELDS.length)
    .default(['country'])
    .describe(
      'Which filter fields to list values for. Each name is a `field` you can use in a ' +
        'subscriber_filter rule. "country", "state" and "city" are the subscriber locations ' +
        'recorded on this site — display names taken from the subscribers themselves, not ISO ' +
        'codes, and different on every site. "device" (mobile/tablet/desktop) and "device_type" ' +
        '(the browser or app platform) have fixed vocabularies, so for those this reports which ' +
        'values this site actually has subscribers on.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(
      `How many values to return PER field, ordered by subscriber count descending. ` +
        `Min 1, max ${MAX_LIMIT}, default ${DEFAULT_LIMIT}. A site can have thousands of cities, ` +
        `so this caps the response; each field reports \`total_values\` and \`truncated\` so you ` +
        `can tell when the list was cut short.`,
    ),
  value_contains: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Optional case-insensitive substring filter on the value names, applied across every ' +
        'requested field. Use it to check one value ("do I have subscribers in Pune?") instead ' +
        'of pulling the whole list.',
    ),
  site_id: z.number().int().positive().optional().describe('Override the currently selected site.'),
});

export type ListAudienceFilterValuesInput = z.infer<typeof ListAudienceFilterValuesInputSchema>;

/**
 * The endpoint's query param is `type_data`, a comma-separated list (the API's stringArray
 * convention). MCP-facing name is `fields`, matching the rule property the values are for.
 */
export function toAudienceFilterValuesQuery(input: ListAudienceFilterValuesInput): {
  type_data: string;
} {
  return { type_data: input.fields.join(',') };
}
