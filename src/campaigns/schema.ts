// src/campaigns/schema.ts
//
// Tools for the "campaigns" category. PushEngage exposes four campaign types, each on its own
// endpoint with its own response shape, mirrored by separate dashboard list pages:
//   - Drip (autoresponder)   GET /automation/drips
//   - Triggered campaigns    GET /automation/triggers
//   - RSS auto push          GET /automation/rss-feeds
//   - Workflows              GET /workflows
// We expose one list tool per type and normalize each to a lean, labeled item. Field labels
// follow the dashboard's vocabulary.
import { z } from 'zod';

import {
  automationStatusLabel,
  dripTypeLabel,
  rssStatusLabel,
  triggerTypeLabel,
  workflowStatusLabel,
} from './labels';

const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 100;

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function toStr(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function num0(value: unknown): number {
  return toNumber(value) ?? 0;
}

// ---- analytics extraction --------------------------------------------------
//
// When a list is requested with analytics, the API embeds per-campaign analytics. We surface
// the same numbers the dashboard's Stats + Goal columns show, using the dashboard's labels.
// Goal count/value are summed across the campaign's `result` map (one entry per goal), matching
// getGoalCount/getGoalValue in pushengage-app/src/helper/index.ts.

function sumGoal(result: unknown): { count: number; value: number } {
  let count = 0;
  let value = 0;
  if (result && typeof result === 'object') {
    for (const entry of Object.values(result as Record<string, unknown>)) {
      if (entry && typeof entry === 'object') {
        count += num0((entry as Record<string, unknown>).count);
        value += num0((entry as Record<string, unknown>).value);
      }
    }
  }
  return { count, value };
}

// Drip + triggered share the notification-analytics shape. Labels match CampaignStats /
// CampaignGoalStats: sent / seen / clicked / CTR + goal count / value.
export type CampaignAnalytics = {
  sent: number;
  seen: number;
  clicked: number;
  ctr: number;
  goal_count: number;
  goal_value: number;
};

function campaignAnalytics(row: Record<string, unknown>): CampaignAnalytics {
  const a = (row.analytics ?? {}) as Record<string, unknown>;
  const goal = sumGoal(row.result);
  return {
    sent: num0(a.sentcount),
    seen: num0(a.views),
    clicked: num0(a.clicks),
    ctr: num0(a.ctr),
    goal_count: goal.count,
    goal_value: goal.value,
  };
}

// Workflow analytics. Labels match WorkflowListTable: Entered / Active / Completed / Failed +
// goal count / value. Active = entered - (completed + failed).
export type WorkflowAnalytics = {
  entered: number;
  active: number;
  completed: number;
  failed: number;
  goal_count: number;
  goal_value: number;
};

function workflowAnalytics(row: Record<string, unknown>): WorkflowAnalytics {
  const a = (row.analytics ?? {}) as Record<string, unknown>;
  const entered = num0(a.entered_users);
  const completed = num0(a.completed_users);
  const failed = num0(a.failed_users);
  const goal = sumGoal(row.result);
  return {
    entered,
    active: entered - (completed + failed),
    completed,
    failed,
    goal_count: goal.count,
    goal_value: goal.value,
  };
}

// ---- inputs ----------------------------------------------------------------
//
// All four campaign lists are paginated by the API. Each takes a `status` filter mirroring the
// dashboard's filter tabs — default "all" (no filter), then the per-type options. Each schema is
// a plain z.object (no .refine) so the MCP SDK can introspect the params.

const paginationBase = z.object({
  site_id: z.number().int().positive().optional().describe('Override the currently selected site.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_LIMIT)
    .default(DEFAULT_LIST_LIMIT)
    .describe(
      `How many to return per page. Min 1, max ${MAX_LIST_LIMIT}, default ${DEFAULT_LIST_LIMIT}.`,
    ),
  page: z.number().int().min(1).default(1).describe('Page number (1-indexed).'),
});

const includeAnalyticsField = z
  .boolean()
  .default(false)
  .describe(
    'When true, include per-campaign analytics (sent/seen/clicked/CTR and goal count/value). ' +
      'Costs an extra analytics lookup, so only set it when the user asks for stats/performance.',
  );

export const ListDripCampaignsInputSchema = paginationBase.extend({
  status: z
    .enum(['all', 'active', 'draft', 'paused'])
    .default('all')
    .describe('Filter by status. "all" (default) returns every status.'),
  include_analytics: includeAnalyticsField,
});

export const ListTriggeredCampaignsInputSchema = paginationBase.extend({
  status: z
    .enum(['all', 'active', 'draft', 'paused', 'archive'])
    .default('all')
    .describe('Filter by status. "all" (default) returns every status.'),
  include_analytics: includeAnalyticsField,
});

export const ListRssCampaignsInputSchema = paginationBase.extend({
  status: z
    .enum(['all', 'active', 'draft', 'paused'])
    .default('all')
    .describe('Filter by status. "all" (default) returns every status.'),
});

export const ListWorkflowsInputSchema = paginationBase.extend({
  status: z
    .enum(['all', 'active', 'inactive', 'draft'])
    .default('all')
    .describe('Filter by status. "all" (default) returns every status.'),
  include_analytics: z
    .boolean()
    .default(false)
    .describe(
      'When true, include per-workflow analytics (entered/active/completed/failed users and ' +
        'goal count/value). Costs an extra analytics lookup; only set it when the user asks for stats.',
    ),
});

export type ListDripCampaignsInput = z.infer<typeof ListDripCampaignsInputSchema>;
export type ListTriggeredCampaignsInput = z.infer<typeof ListTriggeredCampaignsInputSchema>;
export type ListRssCampaignsInput = z.infer<typeof ListRssCampaignsInputSchema>;
export type ListWorkflowsInput = z.infer<typeof ListWorkflowsInputSchema>;

// ---- normalized item shapes + mappers --------------------------------------

// Each item carries the dashboard-facing `status` / `type` label PLUS the raw `*_code` the API
// returned, so the label matches the UI while the raw value stays available for future
// filtering / write tools.
export type DripCampaign = {
  id: number | undefined;
  name: string;
  status: string;
  status_code: string;
  drip_type: string;
  drip_type_code: string;
  created_at: string;
  analytics?: CampaignAnalytics;
};

export function toDripCampaign(
  row: Record<string, unknown>,
  includeAnalytics = false,
): DripCampaign {
  const statusCode = toStr(row.status);
  const typeCode = toStr(row.drip_type);
  return {
    id: toNumber(row.rule_set_id),
    name: toStr(row.rule_set_name),
    status: automationStatusLabel(statusCode),
    status_code: statusCode,
    drip_type: dripTypeLabel(typeCode),
    drip_type_code: typeCode,
    created_at: toStr(row.create_date),
    ...(includeAnalytics ? { analytics: campaignAnalytics(row) } : {}),
  };
}

export type TriggeredCampaign = {
  id: number | undefined;
  name: string;
  type: string;
  type_code: string;
  status: string;
  status_code: string;
  created_at: string;
  analytics?: CampaignAnalytics;
};

export function toTriggeredCampaign(
  row: Record<string, unknown>,
  includeAnalytics = false,
): TriggeredCampaign {
  const statusCode = toStr(row.status);
  const typeCode = toStr(row.campaign_type);
  return {
    id: toNumber(row.trigger_id),
    name: toStr(row.campaign_name),
    type: triggerTypeLabel(typeCode),
    type_code: typeCode,
    status: automationStatusLabel(statusCode),
    status_code: statusCode,
    created_at: toStr(row.created_at),
    ...(includeAnalytics ? { analytics: campaignAnalytics(row) } : {}),
  };
}

export type RssCampaign = {
  id: number | undefined;
  name: string;
  feed_url: string;
  status: string;
  status_code: string;
  created_at: string;
};

export function toRssCampaign(row: Record<string, unknown>): RssCampaign {
  const statusCode = toStr(row.status);
  return {
    id: toNumber(row.campaign_id),
    name: toStr(row.campaign_name),
    feed_url: toStr(row.feed_url),
    status: rssStatusLabel(statusCode),
    status_code: statusCode,
    created_at: toStr(row.created_at),
  };
}

export type Workflow = {
  id: number | undefined;
  name: string;
  status: string;
  status_code: string;
  run_type: string;
  created_at: string;
  analytics?: WorkflowAnalytics;
};

export function toWorkflow(row: Record<string, unknown>, includeAnalytics = false): Workflow {
  const option = (row.option ?? {}) as Record<string, unknown>;
  const statusCode = toStr(row.status);
  return {
    id: toNumber(row.id),
    name: toStr(row.name),
    status: workflowStatusLabel(statusCode),
    status_code: statusCode,
    run_type: toStr(option.run_type),
    created_at: toStr(row.created_at),
    ...(includeAnalytics ? { analytics: workflowAnalytics(row) } : {}),
  };
}

/** Coerce whatever the (unwrapped) list response is into an array of raw rows. */
export function asRows(body: unknown): Array<Record<string, unknown>> {
  let rows: unknown[] = [];
  if (Array.isArray(body)) {
    rows = body;
  } else if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if (Array.isArray(obj.data)) rows = obj.data;
  }
  return rows.map((r) => (r ?? {}) as Record<string, unknown>);
}

export const __testing__ = { toNumber, toStr };
