// src/campaigns/api.ts
import type { ApiClient } from '../http/client';
import {
  type DripCampaign,
  type RssCampaign,
  type TriggeredCampaign,
  type Workflow,
  asRows,
  toDripCampaign,
  toRssCampaign,
  toTriggeredCampaign,
  toWorkflow,
} from './schema';

/** Shared params: paginated list with an optional raw status code (already mapped from the
 * friendly filter value). `status` is omitted from the request when undefined ("all").
 * `includeAnalytics` requests the per-campaign analytics expansion. */
type ListParams = { limit: number; page: number; status?: string; includeAnalytics?: boolean };

function buildQuery(params: ListParams, expand?: string): string {
  const query = new URLSearchParams({
    limit: String(params.limit),
    page: String(params.page),
  });
  if (params.status) query.set('status', params.status);
  if (params.includeAnalytics && expand) query.set('expand', expand);
  return query.toString();
}

export type DripPage = {
  campaigns: DripCampaign[];
  page: number;
  limit: number;
  has_more: boolean;
};

export async function listDripCampaigns(
  client: ApiClient,
  siteId: number,
  params: ListParams,
): Promise<DripPage> {
  const body = await client.get<unknown>(
    `/sites/${siteId}/automation/drips?${buildQuery(params, 'notification_analytics,result_analytics')}`,
  );
  const campaigns = asRows(body).map((row) => toDripCampaign(row, params.includeAnalytics));
  return {
    campaigns,
    page: params.page,
    limit: params.limit,
    has_more: campaigns.length === params.limit,
  };
}

export type TriggeredPage = {
  campaigns: TriggeredCampaign[];
  page: number;
  limit: number;
  has_more: boolean;
};

export async function listTriggeredCampaigns(
  client: ApiClient,
  siteId: number,
  params: ListParams,
): Promise<TriggeredPage> {
  const body = await client.get<unknown>(
    `/sites/${siteId}/automation/triggers?${buildQuery(params, 'notification_analytics,result_analytics')}`,
  );
  const campaigns = asRows(body).map((row) => toTriggeredCampaign(row, params.includeAnalytics));
  return {
    campaigns,
    page: params.page,
    limit: params.limit,
    has_more: campaigns.length === params.limit,
  };
}

export type RssPage = { campaigns: RssCampaign[]; page: number; limit: number; has_more: boolean };

export async function listRssCampaigns(
  client: ApiClient,
  siteId: number,
  params: ListParams,
): Promise<RssPage> {
  const body = await client.get<unknown>(
    `/sites/${siteId}/automation/rss-feeds?${buildQuery(params)}`,
  );
  const campaigns = asRows(body).map(toRssCampaign);
  return {
    campaigns,
    page: params.page,
    limit: params.limit,
    has_more: campaigns.length === params.limit,
  };
}

export type WorkflowPage = {
  workflows: Workflow[];
  page: number;
  limit: number;
  has_more: boolean;
};

export async function listWorkflows(
  client: ApiClient,
  siteId: number,
  params: ListParams,
): Promise<WorkflowPage> {
  const body = await client.get<unknown>(
    `/sites/${siteId}/workflows?${buildQuery(params, 'analytics,result_analytics')}`,
  );
  const workflows = asRows(body).map((row) => toWorkflow(row, params.includeAnalytics));
  return {
    workflows,
    page: params.page,
    limit: params.limit,
    has_more: workflows.length === params.limit,
  };
}

export const __testing__ = { buildQuery };
