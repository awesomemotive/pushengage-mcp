// src/attributes/schema.ts
import { z } from 'zod';

// Limits mirror the API's subscriber-attribute validator.
const MAX_NAME_LENGTH = 128;
const MAX_KEY_LENGTH = 64;
const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 100;

/**
 * The API enforces this regex on `key`. Starts with a letter, then letters / digits /
 * hyphens / underscores. Modelling it on the MCP side gives the LLM an early error
 * instead of a 422 round-trip.
 */
const KEY_REGEX = /^[A-Za-z][A-Za-z0-9_-]*$/;

// ---- pushengage_list_attributes -------------------------------------------------------

export const ListAttributesInputSchema = z.object({
  site_id: z.number().int().positive().optional().describe('Override the currently selected site.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_LIMIT)
    .default(DEFAULT_LIST_LIMIT)
    .describe(
      `How many attributes to return in this page. Min 1, max ${MAX_LIST_LIMIT}, default ${DEFAULT_LIST_LIMIT}. ` +
        `To browse past the first ${MAX_LIST_LIMIT}, increase \`page\` instead of asking for a larger limit.`,
    ),
  page: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe('Page number (1-indexed) for paginating beyond the first batch.'),
  key_contains: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Optional substring filter on the attribute `key`. Maps to API `key_like`. ' +
        'Use this when looking up an attribute by name (e.g. searching for "plan" to find the "plan" attribute key).',
    ),
});

export type ListAttributesInput = z.infer<typeof ListAttributesInputSchema>;

// ---- pushengage_create_attribute ------------------------------------------------------

export const CreateAttributeInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_NAME_LENGTH)
    .describe(
      `Human-readable attribute name shown in the dashboard. 1–${MAX_NAME_LENGTH} chars. e.g. "Customer Plan", "Sign-up Source".`,
    ),
  key: z
    .string()
    .trim()
    .min(1)
    .max(MAX_KEY_LENGTH)
    .regex(
      KEY_REGEX,
      'key must start with a letter and contain only letters, numbers, hyphens, and underscores',
    )
    .describe(
      `The machine identifier used in the JavaScript SDK and in audience-group rules. ` +
        `Must start with a letter and only contain letters, numbers, hyphens, and underscores. ` +
        `Max ${MAX_KEY_LENGTH} chars. e.g. "plan", "signup_source", "lifetime-value". ` +
        `This is the same key you pass as \`key\` on an audience-group rule with field="attributes".`,
    ),
  site_id: z.number().int().positive().optional().describe('Override the currently selected site.'),
});

export type CreateAttributeInput = z.infer<typeof CreateAttributeInputSchema>;

export type ApiCreateAttributeBody = {
  name: string;
  key: string;
};

export function toCreateAttributeApiBody(input: CreateAttributeInput): ApiCreateAttributeBody {
  return { name: input.name, key: input.key };
}
