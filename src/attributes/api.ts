// src/attributes/api.ts
import type { ApiClient } from '../http/client';
import type { ApiCreateAttributeBody } from './schema';

/**
 * Lean SubscriberAttribute shape. Field names mirror the API response:
 *   - `id` — primary key
 *   - `name` — human label shown in the dashboard
 *   - `key` — machine identifier used in audience-group rules and the JS SDK
 *   - `status` — 0/1 (1 = active)
 *   - `created_at`, `updated_at` — ISO timestamps
 */
export type Attribute = {
  id: number;
  name: string;
  key: string;
  status?: 0 | 1;
  created_at?: string;
  updated_at?: string;
};

export type AttributesPage = {
  attributes: Attribute[];
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

function toLeanAttribute(raw: Record<string, unknown>): Attribute | null {
  if (typeof raw.id !== 'number') return null;
  if (typeof raw.name !== 'string') return null;
  if (typeof raw.key !== 'string') return null;
  const out: Attribute = { id: raw.id, name: raw.name, key: raw.key };
  if (raw.status === 0 || raw.status === 1) out.status = raw.status;
  if (typeof raw.created_at === 'string') out.created_at = raw.created_at;
  if (typeof raw.updated_at === 'string') out.updated_at = raw.updated_at;
  return out;
}

export function adaptAttributesEnvelope(
  body: unknown,
  requestedPage: number,
  requestedLimit: number,
): AttributesPage {
  let rows: unknown[] = [];
  let total: number | undefined;
  let lastPage: number | undefined;
  let page = requestedPage;
  let perPage = requestedLimit;

  if (Array.isArray(body)) {
    rows = body;
  } else if (body && typeof body === 'object') {
    const env = body as PaginatedEnvelope & { attributes?: unknown };
    if (Array.isArray(env.data)) rows = env.data;
    else if (Array.isArray(env.attributes)) rows = env.attributes;
    if (typeof env.total === 'number') total = env.total;
    if (typeof env.lastPage === 'number') lastPage = env.lastPage;
    if (typeof env.page === 'number') page = env.page;
    if (typeof env.perPage === 'number') perPage = env.perPage;
  }

  const attributes = rows
    .map((r) => toLeanAttribute(r as Record<string, unknown>))
    .filter((a): a is Attribute => a !== null);

  const hasMore = lastPage !== undefined ? page < lastPage : attributes.length === perPage;

  return {
    attributes,
    page,
    limit: perPage,
    ...(total !== undefined ? { total } : {}),
    ...(lastPage !== undefined ? { last_page: lastPage } : {}),
    has_more: hasMore,
  };
}

export const __testing__ = { adaptAttributesEnvelope, toLeanAttribute };

export async function listAttributes(
  client: ApiClient,
  siteId: number,
  params: { limit: number; page: number; key_contains?: string },
): Promise<AttributesPage> {
  const query = new URLSearchParams({
    limit: String(params.limit),
    page: String(params.page),
  });
  if (params.key_contains) {
    // The API validator's field is `key_like` — we rename to `key_contains` on the MCP boundary.
    query.set('key_like', params.key_contains);
  }
  const path = `/sites/${siteId}/subscriber-attributes?${query.toString()}`;
  const body = await client.get<unknown>(path);
  return adaptAttributesEnvelope(body, params.page, params.limit);
}

export type CreatedAttribute = Attribute;

export async function createAttribute(
  client: ApiClient,
  siteId: number,
  body: ApiCreateAttributeBody,
): Promise<CreatedAttribute> {
  return client.post<CreatedAttribute>(`/sites/${siteId}/subscriber-attributes`, body);
}
