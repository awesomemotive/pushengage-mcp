// src/audienceGroups/api.ts
import type { ApiClient } from '../http/client';
import type { ApiCreateAudienceGroupBody, SubscriberFilter } from './schema';

/**
 * Lean AudienceGroup shape returned by `pushengage_list_audience_groups`. The API column is
 * `id` (not `audience_group_id`) — see AUDIENCE_GROUP_DB_COLUMN.
 */
export type AudienceGroup = {
  id: number;
  name: string;
  description?: string;
  status?: string;
  filter?: SubscriberFilter | Record<string, unknown>;
};

export type AudienceGroupsPage = {
  audience_groups: AudienceGroup[];
  page: number;
  limit: number;
  total?: number;
  last_page?: number;
  has_more: boolean;
};

type PaginatedEnvelope = {
  data?: unknown;
  total?: number;
  perPage?: number;
  page?: number;
  lastPage?: number;
};

function toLeanAudienceGroup(raw: Record<string, unknown>): AudienceGroup | null {
  if (typeof raw.id !== 'number') return null;
  if (typeof raw.name !== 'string') return null;
  const out: AudienceGroup = { id: raw.id, name: raw.name };
  if (typeof raw.description === 'string') out.description = raw.description;
  if (typeof raw.status === 'string') out.status = raw.status;
  if (raw.filter && typeof raw.filter === 'object') {
    out.filter = raw.filter as AudienceGroup['filter'];
  }
  return out;
}

/**
 * Normalize the upstream envelope. The API returns `{ data, total, perPage, page, lastPage }`
 * when both `page` and `limit` are sent; otherwise a bare array. We always send both, so we
 * expect the paginated envelope — but we defend against the other shapes anyway.
 */
export function adaptAudienceGroupsEnvelope(
  body: unknown,
  requestedPage: number,
  requestedLimit: number,
): AudienceGroupsPage {
  let rows: unknown[] = [];
  let total: number | undefined;
  let lastPage: number | undefined;
  let page = requestedPage;
  let perPage = requestedLimit;

  if (Array.isArray(body)) {
    rows = body;
  } else if (body && typeof body === 'object') {
    const env = body as PaginatedEnvelope & { audience_groups?: unknown };
    if (Array.isArray(env.data)) rows = env.data;
    else if (Array.isArray(env.audience_groups)) rows = env.audience_groups;
    if (typeof env.total === 'number') total = env.total;
    if (typeof env.lastPage === 'number') lastPage = env.lastPage;
    if (typeof env.page === 'number') page = env.page;
    if (typeof env.perPage === 'number') perPage = env.perPage;
  }

  const audience_groups = rows
    .map((r) => toLeanAudienceGroup(r as Record<string, unknown>))
    .filter((g): g is AudienceGroup => g !== null);

  const hasMore = lastPage !== undefined ? page < lastPage : audience_groups.length === perPage;

  return {
    audience_groups,
    page,
    limit: perPage,
    ...(total !== undefined ? { total } : {}),
    ...(lastPage !== undefined ? { last_page: lastPage } : {}),
    has_more: hasMore,
  };
}

export const __testing__ = { adaptAudienceGroupsEnvelope, toLeanAudienceGroup };

export async function listAudienceGroups(
  client: ApiClient,
  siteId: number,
  params: { limit: number; page: number; name_contains?: string },
): Promise<AudienceGroupsPage> {
  const query = new URLSearchParams({
    limit: String(params.limit),
    page: String(params.page),
  });
  if (params.name_contains) {
    // The validator field is `name_like`. The MCP renames it to `name_contains` for clarity.
    query.set('name_like', params.name_contains);
  }
  const path = `/sites/${siteId}/audience-groups?${query.toString()}`;
  const body = await client.get<unknown>(path);
  return adaptAudienceGroupsEnvelope(body, params.page, params.limit);
}

export type CreatedAudienceGroup = AudienceGroup;

export async function createAudienceGroup(
  client: ApiClient,
  siteId: number,
  body: ApiCreateAudienceGroupBody,
): Promise<CreatedAudienceGroup> {
  return client.post<CreatedAudienceGroup>(`/sites/${siteId}/audience-groups`, body);
}
