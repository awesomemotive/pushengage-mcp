// src/chatWidgets/schema.ts
//
// Tool for the "chat widgets" category. A chat widget is the floating button that surfaces your
// support channels (WhatsApp, Messenger, etc.) on the site. The dashboard list page
// (GET /sites/:siteId/chat-widgets) shows, per widget: status, the configured channels, which
// devices it shows on, whether it is restricted to business hours, and its targeting. We surface
// the same details, normalized to a lean item with the dashboard's labels.
import { z } from 'zod';

import { channelTypeLabel, chatWidgetStatusLabel, deviceLabel } from './labels';

const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 100;

export const ListChatWidgetsInputSchema = z.object({
  site_id: z.number().int().positive().optional().describe('Override the currently selected site.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_LIMIT)
    .default(DEFAULT_LIST_LIMIT)
    .describe(
      `How many chat widgets to return in this page. Min 1, max ${MAX_LIST_LIMIT}, default ${DEFAULT_LIST_LIMIT}. ` +
        `To browse past the first ${MAX_LIST_LIMIT}, increase \`page\` instead of asking for a larger limit.`,
    ),
  page: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe('Page number (1-indexed) for paginating beyond the first batch.'),
  name_contains: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Optional case-insensitive substring filter on the widget name.'),
  status: z
    .enum(['all', 'active', 'inactive'])
    .default('all')
    .describe('Filter by status. "all" (default) returns every status.'),
});

export type ListChatWidgetsInput = z.infer<typeof ListChatWidgetsInputSchema>;

// ---- normalized item shape + mapper ----------------------------------------

/**
 * Lean chat-widget item. `status` carries the dashboard label ("Active"/"Inactive") while
 * `status_code` keeps the raw value ("enabled"/"disabled"). `channels` is the list of human
 * channel labels the user configured; `devices` is where the widget shows. `business_hours`
 * reflects whether display is restricted to business hours, and `country_targeting` /
 * `page_targeting` summarize the display rules.
 */
export type ChatWidget = {
  id: number | undefined;
  name: string;
  status: string;
  status_code: string;
  channel_count: number;
  channels: string[];
  devices: string[];
  business_hours: boolean;
  country_targeting: { mode: 'all' | 'include' | 'exclude'; countries: string[] };
  page_targeting: 'all' | 'rules_applied';
  created_at: string;
  updated_at: string;
};

function toStr(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** Build the human channel list. For a custom channel, append its custom name when present. */
function extractChannels(config: Record<string, unknown>): string[] {
  const channels = Array.isArray(config.channels) ? config.channels : [];
  return channels.map((raw) => {
    const ch = asObject(raw);
    const type = toStr(ch.type);
    const label = channelTypeLabel(type);
    if (type === 'custom') {
      const name = toStr(ch.channel_name).trim();
      return name ? `${label} - ${name}` : label;
    }
    return label;
  });
}

function extractDevices(config: Record<string, unknown>): string[] {
  const showOn = Array.isArray(config.show_on) ? config.show_on : [];
  return showOn.map((d) => deviceLabel(toStr(d)));
}

/** Mirrors the dashboard: business hours can be a bare boolean or an object with `enabled`. */
function extractBusinessHours(displayRules: Record<string, unknown>): boolean {
  const biz = displayRules.business_hours;
  if (typeof biz === 'boolean') return biz;
  return Boolean(asObject(biz).enabled);
}

/**
 * Summarize country targeting from the display rules. Mirrors the dashboard's getTargetingCountries:
 * an `in` rule means "only these countries" (include), `nin` means "every country except these"
 * (exclude), and no country rule means all countries.
 */
function extractCountryTargeting(
  displayRules: Record<string, unknown>,
): ChatWidget['country_targeting'] {
  const groups = Array.isArray(displayRules.rule_groups) ? displayRules.rule_groups : [];
  const included: string[] = [];
  const excluded: string[] = [];
  for (const group of groups) {
    const rules = Array.isArray(asObject(group).rules) ? (asObject(group).rules as unknown[]) : [];
    for (const raw of rules) {
      const rule = asObject(raw);
      if (rule.type !== 'country') continue;
      const values = Array.isArray(rule.value) ? rule.value.map((v) => toStr(v)) : [];
      if (rule.op === 'in') included.push(...values);
      else if (rule.op === 'nin') excluded.push(...values);
    }
  }
  if (included.length) return { mode: 'include', countries: Array.from(new Set(included)) };
  if (excluded.length) return { mode: 'exclude', countries: Array.from(new Set(excluded)) };
  return { mode: 'all', countries: [] };
}

/** Whether any URL (page) rule is applied, vs showing on all pages. */
function extractPageTargeting(displayRules: Record<string, unknown>): 'all' | 'rules_applied' {
  const groups = Array.isArray(displayRules.rule_groups) ? displayRules.rule_groups : [];
  for (const group of groups) {
    const rules = Array.isArray(asObject(group).rules) ? (asObject(group).rules as unknown[]) : [];
    if (rules.some((raw) => asObject(raw).type === 'url')) return 'rules_applied';
  }
  return 'all';
}

export function toChatWidget(row: Record<string, unknown>): ChatWidget {
  const config = asObject(row.config);
  const behavior = asObject(config.behavior);
  const displayRules = asObject(behavior.display_rules);
  const statusCode = toStr(row.status);
  const channels = extractChannels(config);
  return {
    id: typeof row.id === 'number' ? row.id : undefined,
    name: toStr(row.name),
    status: chatWidgetStatusLabel(statusCode),
    status_code: statusCode,
    channel_count: channels.length,
    channels,
    devices: extractDevices(config),
    business_hours: extractBusinessHours(displayRules),
    country_targeting: extractCountryTargeting(displayRules),
    page_targeting: extractPageTargeting(displayRules),
    created_at: toStr(row.created_at),
    updated_at: toStr(row.updated_at),
  };
}

export const __testing__ = { extractChannels, extractCountryTargeting, extractPageTargeting };
