// src/analytics/schema.ts
import { z } from 'zod';

export const GetAnalyticsSummaryInputSchema = z.object({
  site_id: z.number().int().positive().optional().describe('Override the currently selected site.'),
});

export type GetAnalyticsSummaryInput = z.infer<typeof GetAnalyticsSummaryInputSchema>;

/**
 * Lifetime, site-wide totals returned by the tool. Sourced from the dedicated
 * `/analytics/totals` endpoint: subscriber count is the current active count, sent/views/clicks
 * are lifetime notification analytics, and the goal figures are lifetime goal totals.
 */
export type AnalyticsSummary = {
  total_subscribers: number;
  total_notifications_sent: number;
  total_views: number;
  total_clicks: number;
  total_goal_count: number;
  total_goal_value: number;
};

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Pull the `total_*` fields out of the analytics-summary response `meta` block. Defensive about
 * missing keys / string numbers so a partial response degrades to 0 rather than NaN.
 */
export function toAnalyticsSummary(
  totals: Record<string, unknown> | null | undefined,
): AnalyticsSummary {
  const t = totals ?? {};
  return {
    total_subscribers: toNumber(t.total_subscribers),
    total_notifications_sent: toNumber(t.total_notifications_sent),
    total_views: toNumber(t.total_views),
    total_clicks: toNumber(t.total_clicks),
    total_goal_count: toNumber(t.total_goal_count),
    total_goal_value: toNumber(t.total_goal_value),
  };
}

// ---- pushengage_get_analytics_timeseries ---------------------------------------------

/** Matches the API's date format: YYYY-MM-DD. */
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// The MCP SDK introspects `inputSchema` to build the JSON Schema the LLM sees, and it can only
// enumerate properties on a plain ZodObject. `.refine()` returns a ZodEffects, which the SDK
// renders with empty `properties` (the LLM then sees no params). So we split: register the plain
// `...Object` as inputSchema, and re-parse through `...Schema` (with the cross-field rule) in the
// tool handler. Same pattern as SendNotificationInputObject / Schema in src/notifications.
export const GetAnalyticsTimeseriesInputObject = z.object({
  start_date: z
    .string()
    .regex(DATE_REGEX, 'Must be YYYY-MM-DD')
    .describe('Start of the range (inclusive). Format: YYYY-MM-DD.'),
  end_date: z
    .string()
    .regex(DATE_REGEX, 'Must be YYYY-MM-DD')
    .describe('End of the range (inclusive). Format: YYYY-MM-DD. Must be on or after start_date.'),
  group_by: z
    .enum(['day', 'week', 'month'])
    .default('day')
    .describe('How to bucket the series: one point per day, week, or month.'),
  site_id: z.number().int().positive().optional().describe('Override the currently selected site.'),
});

export const GetAnalyticsTimeseriesInputSchema = GetAnalyticsTimeseriesInputObject.refine(
  (d) => d.end_date >= d.start_date,
  {
    message: 'end_date must be on or after start_date',
    path: ['end_date'],
  },
);

export type GetAnalyticsTimeseriesInput = z.infer<typeof GetAnalyticsTimeseriesInputSchema>;

/**
 * One bucket of the analytics time series. Keys are renamed from the API's terse columns to the
 * user-readable labels the dashboard uses (see src/helper/index.ts in pushengage-app):
 *   date_create   -> period          (ISO "YYYY-MM-DD" for day, "start,end" for week, ISO "YYYY-MM" for month)
 *   subscribers   -> subscribers     (new subscribers gained in the bucket)
 *   notifications_sent -> notifications_sent
 *   views         -> views
 *   click         -> clicks
 *   click_rate    -> ctr             (click-through rate, %)
 *   unsubscribed  -> unsubscribed
 */
export type AnalyticsTimeseriesPoint = {
  period: string;
  subscribers: number;
  notifications_sent: number;
  views: number;
  clicks: number;
  ctr: number;
  unsubscribed: number;
};

type GroupBy = 'day' | 'week' | 'month';

/**
 * Normalize the API's per-bucket period label to a consistent format. Day buckets already arrive
 * as ISO `YYYY-MM-DD`. Month buckets arrive as `"M,YYYY"` (e.g. "6,2026"); we reformat those to
 * ISO `YYYY-MM` so the series isn't a mix of `2026-06-27` and `6,2026`. Week buckets ("start,end")
 * are left as-is.
 */
function formatPeriod(raw: string, groupBy?: GroupBy): string {
  if (groupBy === 'month') {
    const m = raw.match(/^(\d{1,2}),(\d{4})$/);
    if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  }
  return raw;
}

export function toTimeseriesPoint(
  row: Record<string, unknown>,
  groupBy?: GroupBy,
): AnalyticsTimeseriesPoint {
  const rawPeriod =
    typeof row.date_create === 'string' ? row.date_create : String(row.date_create ?? '');
  return {
    period: formatPeriod(rawPeriod, groupBy),
    subscribers: toNumber(row.subscribers),
    notifications_sent: toNumber(row.notifications_sent),
    views: toNumber(row.views),
    clicks: toNumber(row.click),
    ctr: toNumber(row.click_rate),
    unsubscribed: toNumber(row.unsubscribed),
  };
}

export function toAnalyticsTimeseries(
  rows: unknown,
  groupBy?: GroupBy,
): AnalyticsTimeseriesPoint[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => toTimeseriesPoint((r ?? {}) as Record<string, unknown>, groupBy));
}

export const __testing__ = { toNumber };
