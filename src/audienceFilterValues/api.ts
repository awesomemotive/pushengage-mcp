// src/audienceFilterValues/api.ts
import type { ApiClient } from '../http/client';
import type { ListAudienceFilterValuesInput } from './schema';

/**
 * One selectable value plus how many active subscribers carry it.
 *
 * The endpoint (`GET /sites/:siteId/geo-segments`) returns `{ <field>: { <value>: <count> } }` —
 * the service calls `dexter.subscriber.getActiveSubscriberCountByAttribute`, so the map is keyed
 * by the value itself and the number is a subscriber count. The dashboard reads only
 * `Object.keys(...)` to populate its dropdowns and discards the counts; we keep them, because
 * "India (12,480 subscribers)" tells the model far more than "India" about whether a filter will
 * reach anyone.
 */
export type AudienceFilterValue = {
  value: string;
  subscribers: number;
};

export type AudienceFilterFieldValues = {
  values: AudienceFilterValue[];
  /** Total distinct values before `limit` / `value_contains` were applied. */
  total_values: number;
  /** True when `values` was cut short by `limit`. */
  truncated: boolean;
};

export type AudienceFilterValuesResult = {
  fields: Record<string, AudienceFilterFieldValues>;
};

function toCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
}

/**
 * Normalize `{ country: { India: 12480, ... } }` into sorted, capped arrays.
 *
 * Defensive in the same spirit as the other `adapt*Envelope` helpers: an absent or non-object
 * entry for a requested field yields an empty result rather than throwing, because a site with no
 * subscribers in a category simply has nothing to report.
 */
export function adaptAudienceFilterValuesEnvelope(
  body: unknown,
  requestedFields: readonly string[],
  limit: number,
  valueContains?: string,
): AudienceFilterValuesResult {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const needle = valueContains?.toLowerCase();
  const fields: Record<string, AudienceFilterFieldValues> = {};

  for (const field of requestedFields) {
    const raw = (source as Record<string, unknown>)[field];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      fields[field] = { values: [], total_values: 0, truncated: false };
      continue;
    }

    let entries: AudienceFilterValue[] = Object.entries(raw as Record<string, unknown>)
      // Blank keys occur when a subscriber's location could not be resolved; they are not
      // selectable in the dashboard either.
      .filter(([value]) => value.trim() !== '')
      .map(([value, count]) => ({ value, subscribers: toCount(count) }));

    if (needle) {
      entries = entries.filter((e) => e.value.toLowerCase().includes(needle));
    }

    const totalValues = entries.length;

    // Highest-reach values first: a model picking from a truncated list should see the ones that
    // matter. Ties fall back to name order so the output is stable across calls.
    entries.sort((a, b) =>
      b.subscribers !== a.subscribers
        ? b.subscribers - a.subscribers
        : a.value.localeCompare(b.value),
    );

    fields[field] = {
      values: entries.slice(0, limit),
      total_values: totalValues,
      truncated: totalValues > limit,
    };
  }

  return { fields };
}

export const __testing__ = { adaptAudienceFilterValuesEnvelope };

export async function listAudienceFilterValues(
  client: ApiClient,
  siteId: number,
  input: ListAudienceFilterValuesInput,
): Promise<AudienceFilterValuesResult> {
  // Route name is historical (`geo-segments`); it serves device values too.
  const query = new URLSearchParams({ type_data: input.fields.join(',') });
  const path = `/sites/${siteId}/geo-segments?${query.toString()}`;
  const body = await client.get<unknown>(path);
  return adaptAudienceFilterValuesEnvelope(body, input.fields, input.limit, input.value_contains);
}
