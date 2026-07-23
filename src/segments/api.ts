// src/segments/api.ts
import type { ApiClient } from '../http/client';
import type { ApiCreateSegmentBody } from './schema';

/**
 * Lean Segment shape returned by `pushengage_list_segments`. Field names mirror SEGMENT_DB_COLUMN
 * (`segment_id`, `segment_name`, `segment_criteria`, `add_segment_on_page_load`, `status`)
 * plus the `subscribers` count the API merges in from analytics.
 */
export type Segment = {
  segment_id: number;
  segment_name: string;
  segment_criteria?: {
    include?: Array<{ rule: string; value: string }>;
    exclude?: Array<{ rule: string; value: string }>;
  };
  add_segment_on_page_load?: number;
  status?: number;
  subscribers?: number;
};

export type SegmentsPage = {
  segments: Segment[];
  page: number;
  limit: number;
  total?: number;
  last_page?: number;
  has_more: boolean;
};

type PaginatedSegmentsEnvelope = {
  data?: unknown;
  total?: number;
  perPage?: number;
  page?: number;
  lastPage?: number;
};

function toLeanSegment(raw: Record<string, unknown>): Segment | null {
  if (typeof raw.segment_id !== 'number') return null;
  if (typeof raw.segment_name !== 'string') return null;
  const out: Segment = {
    segment_id: raw.segment_id,
    segment_name: raw.segment_name,
  };
  if (raw.segment_criteria && typeof raw.segment_criteria === 'object') {
    out.segment_criteria = raw.segment_criteria as Segment['segment_criteria'];
  }
  if (typeof raw.add_segment_on_page_load === 'number') {
    out.add_segment_on_page_load = raw.add_segment_on_page_load;
  }
  if (typeof raw.status === 'number') out.status = raw.status;
  if (typeof raw.subscribers === 'number') out.subscribers = raw.subscribers;
  return out;
}

/**
 * Normalize whatever shape the upstream `/sites/:siteId/segments` endpoint returns
 * into a `{ segments, page, limit, ... }` page. Mirrors the defensive adapter in
 * the sites module — handles paginated `{ data: [...] }`, bare arrays, and unknown
 * shapes.
 */
export function adaptSegmentsEnvelope(
  body: unknown,
  requestedPage: number,
  requestedLimit: number,
): SegmentsPage {
  let rows: unknown[] = [];
  let total: number | undefined;
  let lastPage: number | undefined;
  let page = requestedPage;
  let perPage = requestedLimit;

  if (Array.isArray(body)) {
    rows = body;
  } else if (body && typeof body === 'object') {
    const env = body as PaginatedSegmentsEnvelope & { segments?: unknown };
    if (Array.isArray(env.data)) rows = env.data;
    else if (Array.isArray(env.segments)) rows = env.segments;
    if (typeof env.total === 'number') total = env.total;
    if (typeof env.lastPage === 'number') lastPage = env.lastPage;
    if (typeof env.page === 'number') page = env.page;
    if (typeof env.perPage === 'number') perPage = env.perPage;
  }

  const segments = rows
    .map((row) => toLeanSegment(row as Record<string, unknown>))
    .filter((s): s is Segment => s !== null);

  const hasMore = lastPage !== undefined ? page < lastPage : segments.length === perPage;

  return {
    segments,
    page,
    limit: perPage,
    ...(total !== undefined ? { total } : {}),
    ...(lastPage !== undefined ? { last_page: lastPage } : {}),
    has_more: hasMore,
  };
}

export const __testing__ = { adaptSegmentsEnvelope, toLeanSegment };

export async function listSegments(
  client: ApiClient,
  siteId: number,
  params: { limit: number; page: number; name_contains?: string },
): Promise<SegmentsPage> {
  const query = new URLSearchParams({
    limit: String(params.limit),
    page: String(params.page),
  });
  if (params.name_contains) {
    // The validator uses REQ_CONST.segmentNameLike — keep the API param name in sync.
    query.set('segment_name_like', params.name_contains);
  }
  const path = `/sites/${siteId}/segments?${query.toString()}`;
  const body = await client.get<unknown>(path);
  return adaptSegmentsEnvelope(body, params.page, params.limit);
}

export type CreatedSegment = Segment;

export async function createSegment(
  client: ApiClient,
  siteId: number,
  body: ApiCreateSegmentBody,
): Promise<CreatedSegment> {
  return client.post<CreatedSegment>(`/sites/${siteId}/segments`, body);
}
