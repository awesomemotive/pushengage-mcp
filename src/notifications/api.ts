// src/notifications/api.ts
import type { ApiClient } from '../http/client';
import type {
  ApiAbNotificationBody,
  ApiListNotificationsQuery,
  ApiNotificationBody,
  SendAbNotificationInput,
  SendNotificationInput,
} from './schema';

export type CreatedNotification = {
  notification_id: number;
  status: string;
  notification_title: string;
  notification_message: string;
  notification_url: string;
  valid_from?: string;
};

export async function createNotification(
  client: ApiClient,
  siteId: number,
  input: SendNotificationInput,
  body: ApiNotificationBody,
): Promise<CreatedNotification> {
  const action = input.status === 'draft' ? 'draft' : 'sent';
  const path = `/sites/${siteId}/notifications?action=${action}&type=generic`;
  return client.post<CreatedNotification>(path, body);
}

/**
 * The A/B notification response carries the A-variant fields at the top level plus an
 * `ab_notification_id` that identifies the test pair. The API returns both ids via the
 * standard envelope, so callers can deep-link to the test detail page.
 */
export type CreatedAbNotification = CreatedNotification & {
  ab_notification_id?: number;
};

type AbCreateApiResponse = {
  ab?: { id?: number; status?: string };
  A?: {
    notification_id?: number;
    notification_title?: string;
    notification_message?: string;
    notification_url?: string;
    valid_from?: string;
    status?: string;
  };
};

function normalizeAbCreateResponse(raw: AbCreateApiResponse): CreatedAbNotification {
  const variantA = raw.A ?? {};
  return {
    notification_id: variantA.notification_id ?? 0,
    ab_notification_id: raw.ab?.id,
    status: raw.ab?.status ?? variantA.status ?? '',
    notification_title: variantA.notification_title ?? '',
    notification_message: variantA.notification_message ?? '',
    notification_url: variantA.notification_url ?? '',
    ...(variantA.valid_from ? { valid_from: variantA.valid_from } : {}),
  };
}

export async function createAbNotification(
  client: ApiClient,
  siteId: number,
  input: SendAbNotificationInput,
  body: ApiAbNotificationBody,
): Promise<CreatedAbNotification> {
  const action = input.status === 'draft' ? 'draft' : 'sent';
  const path = `/sites/${siteId}/notifications?action=${action}&type=ab`;
  const raw = await client.post<AbCreateApiResponse>(path, body);
  return normalizeAbCreateResponse(raw);
}

// ---- pushengage_list_notifications ---------------------------------------------------

/**
 * Lean row returned by `pushengage_list_notifications`. MCP-facing names drop the
 * `notification_` prefix (matching the send tools' inputs) and rename the API's counter
 * columns: viewcount → view_count, clickcount → click_count, sentcount → sent_count, and
 * failedcount → unsubscribe_count (the API stores unsubscribes in `failedcount`).
 */
export type NotificationAction = {
  label: string;
  url: string;
};

/**
 * UTM config as stored on the notification; when none was configured the API falls back to
 * whatever utm_* params it finds on the notification URL (no `enabled` key in that case).
 */
export type NotificationUtmParams = {
  enabled?: boolean;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
};

/**
 * Lean targeting summary derived from the row's transformed `notification_criteria`.
 * The API's `audience` mode (`{ audience: { groups, group_list } }`) is flattened into
 * `audience_groups: [{ id, name? }]` — the ids are directly reusable as
 * `pushengage_send_notification`'s `audience_groups` input. `filter` (the 2-D DNF the
 * dashboard's custom targeting produces) passes through untouched. `timezone` /
 * `tz_scheduled_time` appear on subscriber-timezone sends. An absent `criteria` field
 * means the notification targeted all subscribers.
 */
export type NotificationCriteria = {
  audience_groups?: Array<{ id: number; name?: string }>;
  filter?: unknown;
  timezone?: string | number;
  tz_scheduled_time?: string;
};

export type NotificationListItem = {
  notification_id: number;
  title: string;
  message?: string;
  url?: string;
  status: string;
  source?: string;
  image_url?: string;
  big_image_url?: string;
  actions?: NotificationAction[];
  utm_params?: NotificationUtmParams;
  criteria?: NotificationCriteria;
  sent_at?: string;
  schedule_date?: string;
  created_at?: string;
  sent_count?: number;
  view_count?: number;
  click_count?: number;
  unsubscribe_count?: number;
  ctr?: number;
  goal_count?: number;
  goal_value?: number;
  tags?: string[];
};

export type NotificationsPage = {
  notifications: NotificationListItem[];
  page: number;
  limit: number;
  total?: number;
  last_page?: number;
  has_more: boolean;
};

type PaginatedNotificationsEnvelope = {
  data?: unknown;
  total?: number;
  perPage?: number;
  page?: number;
  lastPage?: number;
};

/** Unsent rows carry the API's zero-date placeholder — treat it as "no date". */
const ZERO_DATE = '0000-00-00 00:00:00';

function toCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function toDate(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' && value !== ZERO_DATE ? value : undefined;
}

/**
 * Action buttons arrive pre-shaped as `{ label, url, final_url, image_url? }`, where `url` is
 * UTM-stripped and `final_url` keeps the UTM params. Keep only label + url (matching the
 * row's top-level UTM-stripped `url`; the icon and final_url aren't useful to the LLM) and
 * drop malformed entries.
 */
function toActions(value: unknown): NotificationAction[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const actions: NotificationAction[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.label !== 'string' || typeof raw.url !== 'string') continue;
    actions.push({ label: raw.label, url: raw.url });
  }
  return actions.length > 0 ? actions : undefined;
}

function toCriteria(value: unknown): NotificationCriteria | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const out: NotificationCriteria = {};

  if (raw.audience && typeof raw.audience === 'object' && !Array.isArray(raw.audience)) {
    const audience = raw.audience as Record<string, unknown>;
    // group_list carries `{ id, name }` lookups for the ids in `groups`; a group deleted
    // since the send won't have an entry, so `name` stays optional.
    const names = new Map<number, string>();
    if (Array.isArray(audience.group_list)) {
      for (const entry of audience.group_list) {
        if (!entry || typeof entry !== 'object') continue;
        const group = entry as Record<string, unknown>;
        const id = toCount(group.id);
        if (id !== undefined && typeof group.name === 'string') names.set(id, group.name);
      }
    }
    if (Array.isArray(audience.groups)) {
      const groups: NonNullable<NotificationCriteria['audience_groups']> = [];
      for (const rawId of audience.groups) {
        const id = toCount(rawId);
        if (id === undefined) continue;
        const name = names.get(id);
        groups.push(name !== undefined ? { id, name } : { id });
      }
      if (groups.length > 0) out.audience_groups = groups;
    }
  }

  if (raw.filter !== undefined && raw.filter !== null) out.filter = raw.filter;
  if (typeof raw.timezone === 'string' || typeof raw.timezone === 'number') {
    out.timezone = raw.timezone;
  }
  if (typeof raw.tz_scheduled_time === 'string') out.tz_scheduled_time = raw.tz_scheduled_time;

  return Object.keys(out).length > 0 ? out : undefined;
}

const UTM_STRING_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;

function toUtmParams(value: unknown): NotificationUtmParams | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const out: NotificationUtmParams = {};
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
  for (const key of UTM_STRING_KEYS) {
    const entry = raw[key];
    if (typeof entry === 'string' && entry !== '') out[key] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Each row's `result` map is one entry per goal name → `{ count, value }` (populated only when
 * the request expands result_analytics). Sum across goals into goal_count/goal_value, matching
 * the campaigns module's convention.
 */
function toGoal(value: unknown): { count: number; value: number } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.values(value as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  let count = 0;
  let total = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    count += toCount(raw.count) ?? 0;
    total += toCount(raw.value) ?? 0;
  }
  return { count, value: total };
}

function toLeanNotification(raw: Record<string, unknown>): NotificationListItem | null {
  const id = toCount(raw.notification_id);
  if (id === undefined) return null;
  if (typeof raw.notification_title !== 'string') return null;
  const out: NotificationListItem = {
    notification_id: id,
    title: raw.notification_title,
    status: typeof raw.status === 'string' ? raw.status : '',
  };
  if (typeof raw.notification_message === 'string') out.message = raw.notification_message;
  if (typeof raw.notification_url === 'string') out.url = raw.notification_url;
  if (typeof raw.source === 'string') out.source = raw.source;
  // Image columns keep their raw API names (`notification_image`, `big_image`); the MCP
  // exposes the send tool's input names (`image_url`, `big_image_url`).
  if (typeof raw.notification_image === 'string' && raw.notification_image !== '') {
    out.image_url = raw.notification_image;
  }
  if (typeof raw.big_image === 'string' && raw.big_image !== '') {
    out.big_image_url = raw.big_image;
  }
  const actions = toActions(raw.actions);
  if (actions) out.actions = actions;
  const utmParams = toUtmParams(raw.utm_params);
  if (utmParams) out.utm_params = utmParams;
  const criteria = toCriteria(raw.notification_criteria);
  if (criteria) out.criteria = criteria;
  const sentAt = toDate(raw.sent_at);
  if (sentAt) out.sent_at = sentAt;
  // `valid_from` is the one-shot schedule date; for recurring notifications the API reuses
  // it as the recurrence end date.
  const scheduleDate = toDate(raw.valid_from);
  if (scheduleDate) out.schedule_date = scheduleDate;
  const createdAt = toDate(raw.created_at);
  if (createdAt) out.created_at = createdAt;
  const sentCount = toCount(raw.sentcount);
  if (sentCount !== undefined) out.sent_count = sentCount;
  const viewCount = toCount(raw.viewcount);
  if (viewCount !== undefined) out.view_count = viewCount;
  const clickCount = toCount(raw.clickcount);
  if (clickCount !== undefined) out.click_count = clickCount;
  const unsubscribeCount = toCount(raw.failedcount);
  if (unsubscribeCount !== undefined) out.unsubscribe_count = unsubscribeCount;
  const ctr = toCount(raw.ctr);
  if (ctr !== undefined) out.ctr = ctr;
  const goal = toGoal(raw.result);
  if (goal) {
    out.goal_count = goal.count;
    out.goal_value = goal.value;
  }
  if (Array.isArray(raw.tags) && raw.tags.length > 0) {
    out.tags = raw.tags.filter((t): t is string => typeof t === 'string');
  }
  return out;
}

/**
 * Normalize whatever shape the upstream `/sites/:siteId/notifications` endpoint returns into
 * a `{ notifications, page, limit, ... }` page. Mirrors the defensive adapter in the segments
 * module — handles paginated `{ data: [...] }`, bare arrays, and unknown shapes.
 */
export function adaptNotificationsEnvelope(
  body: unknown,
  requestedPage: number,
  requestedLimit: number,
): NotificationsPage {
  let rows: unknown[] = [];
  let total: number | undefined;
  let lastPage: number | undefined;
  let page = requestedPage;
  let perPage = requestedLimit;

  if (Array.isArray(body)) {
    rows = body;
  } else if (body && typeof body === 'object') {
    const env = body as PaginatedNotificationsEnvelope & { notifications?: unknown };
    if (Array.isArray(env.data)) rows = env.data;
    else if (Array.isArray(env.notifications)) rows = env.notifications;
    if (typeof env.total === 'number') total = env.total;
    if (typeof env.lastPage === 'number') lastPage = env.lastPage;
    if (typeof env.page === 'number') page = env.page;
    if (typeof env.perPage === 'number') perPage = env.perPage;
  }

  const notifications = rows
    .map((row) => toLeanNotification(row as Record<string, unknown>))
    .filter((n): n is NotificationListItem => n !== null);

  const hasMore = lastPage !== undefined ? page < lastPage : notifications.length === perPage;

  return {
    notifications,
    page,
    limit: perPage,
    ...(total !== undefined ? { total } : {}),
    ...(lastPage !== undefined ? { last_page: lastPage } : {}),
    has_more: hasMore,
  };
}

export const __testing__ = { adaptNotificationsEnvelope, toLeanNotification };

export async function listNotifications(
  client: ApiClient,
  siteId: number,
  params: ApiListNotificationsQuery,
): Promise<NotificationsPage> {
  const query = new URLSearchParams({
    limit: String(params.limit),
    page: String(params.page),
  });
  if (params.status) query.set('status', params.status);
  if (params.start_sent_at) query.set('start_sent_at', params.start_sent_at);
  if (params.end_sent_at) query.set('end_sent_at', params.end_sent_at);
  if (params.tags) query.set('tags', params.tags);
  if (params.tags_exclude) query.set('tags_exclude', params.tags_exclude);
  if (params.expand) query.set('expand', params.expand);
  const path = `/sites/${siteId}/notifications?${query.toString()}`;
  const body = await client.get<unknown>(path);
  return adaptNotificationsEnvelope(body, params.page, params.limit);
}
