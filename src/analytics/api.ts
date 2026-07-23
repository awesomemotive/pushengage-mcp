// src/analytics/api.ts
import type { ApiClient } from '../http/client';
import {
  type AnalyticsSummary,
  type AnalyticsTimeseriesPoint,
  toAnalyticsSummary,
  toAnalyticsTimeseries,
} from './schema';

/**
 * Calls the dedicated lean totals endpoint (GET /sites/:siteId/analytics/totals), which returns
 * just the all-time totals in `data` — no date range, no period-comparison blocks, far fewer DB
 * queries than the full /analytics/summary endpoint.
 */
export async function getAnalyticsSummary(
  client: ApiClient,
  siteId: number,
): Promise<AnalyticsSummary> {
  const totals = await client.get<Record<string, unknown>>(`/sites/${siteId}/analytics/totals`);
  return toAnalyticsSummary(totals);
}

/**
 * Calls the full summary endpoint for the time series. We deliberately omit `expand`, so the API
 * skips the all-time/period-comparison meta queries and returns only the per-bucket `data` rows
 * — which `client.get()` unwraps for us.
 */
export async function getAnalyticsTimeseries(
  client: ApiClient,
  siteId: number,
  params: { start_date: string; end_date: string; group_by: 'day' | 'week' | 'month' },
): Promise<AnalyticsTimeseriesPoint[]> {
  const query = new URLSearchParams({
    start_created_at: params.start_date,
    end_created_at: params.end_date,
    group_by: params.group_by,
  });
  const rows = await client.get<unknown>(`/sites/${siteId}/analytics/summary?${query.toString()}`);
  return toAnalyticsTimeseries(rows, params.group_by);
}
