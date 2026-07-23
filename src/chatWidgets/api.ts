// src/chatWidgets/api.ts
import type { ApiClient } from '../http/client';
import { type ChatWidget, toChatWidget } from './schema';

export type ChatWidgetsPage = {
  chat_widgets: ChatWidget[];
  page: number;
  limit: number;
  total?: number;
  last_page?: number;
  has_more: boolean;
};

type PaginatedChatWidgetsEnvelope = {
  data?: unknown;
  total?: number;
  perPage?: number;
  page?: number;
  lastPage?: number;
};

/**
 * Normalize the `/sites/:siteId/chat-widgets` response into a `{ chat_widgets, page, limit, ... }`
 * page. The endpoint returns a paginated `{ data, total, perPage, page, lastPage }` envelope; we
 * also tolerate a bare array and unknown shapes, like the other list adapters.
 */
export function adaptChatWidgetsEnvelope(
  body: unknown,
  requestedPage: number,
  requestedLimit: number,
): ChatWidgetsPage {
  let rows: unknown[] = [];
  let total: number | undefined;
  let lastPage: number | undefined;
  let page = requestedPage;
  let perPage = requestedLimit;

  if (Array.isArray(body)) {
    rows = body;
  } else if (body && typeof body === 'object') {
    const env = body as PaginatedChatWidgetsEnvelope;
    if (Array.isArray(env.data)) rows = env.data;
    if (typeof env.total === 'number') total = env.total;
    if (typeof env.lastPage === 'number') lastPage = env.lastPage;
    if (typeof env.page === 'number') page = env.page;
    if (typeof env.perPage === 'number') perPage = env.perPage;
  }

  const chatWidgets = rows.map((row) => toChatWidget((row ?? {}) as Record<string, unknown>));
  const hasMore = lastPage !== undefined ? page < lastPage : chatWidgets.length === perPage;

  return {
    chat_widgets: chatWidgets,
    page,
    limit: perPage,
    ...(total !== undefined ? { total } : {}),
    ...(lastPage !== undefined ? { last_page: lastPage } : {}),
    has_more: hasMore,
  };
}

export const __testing__ = { adaptChatWidgetsEnvelope };

export async function listChatWidgets(
  client: ApiClient,
  siteId: number,
  params: { limit: number; page: number; name_contains?: string; status?: string },
): Promise<ChatWidgetsPage> {
  const query = new URLSearchParams({
    limit: String(params.limit),
    page: String(params.page),
  });
  if (params.name_contains) query.set('name', params.name_contains);
  if (params.status) query.set('status', params.status);
  const body = await client.get<unknown>(`/sites/${siteId}/chat-widgets?${query.toString()}`);
  return adaptChatWidgetsEnvelope(body, params.page, params.limit);
}
