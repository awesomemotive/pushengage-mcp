// src/subscriberFilter/resolve.ts
//
// Turns the caller's filter into one the API can be trusted with: segment names become segment
// IDs, and every segment reference and attribute key is checked against what the site actually
// has. Anything that does not resolve fails the call.
//
// WHY THIS IS NOT OPTIONAL
//
// The API does not reject an unknown segment reference — it silently DROPS it, and a filter that
// drops to nothing is omitted, which the API reads as "all subscribers". On the create path,
// `createNotification` loads the site's ACTIVE segments and passes them to `formatCriteriaFilter`
// (pushengage-adonis-node-api, app/Helpers/Notification.js:1283), which keeps only values present
// in that map; a rule with no survivors is removed, a group with no rules is removed, and
// `notificationCriteriaForReqPayload` merges `filter` only `if (formattedFilter.length)`.
//
// So one mistyped segment name does not quietly reach nobody — it quietly reaches the entire
// subscriber list, and the API returns 200. That is irreversible and invisible, which is why
// resolution here hard-fails instead of letting anything through, and why it resolves against the
// same ACTIVE set the API scrubs against (a paused segment must fail, because passing its ID
// widens the send exactly as an invented ID would).

import { listAttributes } from '../attributes/api';
import type { ApiClient } from '../http/client';
import { ValidationError } from '../http/errors';
import { SEGMENT_STATUS_ACTIVE, listSegments } from '../segments/api';
import type { Segment } from '../segments/api';
import { convertFilterDatesToUtc } from './dates';
import type { FilterDateConversion } from './dates';
import { attributeKeysIn, hasSegmentRule } from './schema';
import type { SubscriberFilter, SubscriberRule } from './schema';

/** Page size for the lookup sweeps. 100 is the API's max. */
const LOOKUP_PAGE_SIZE = 100;

/**
 * How many pages we will sweep before giving up. 10 × 100 = 1000 segments, far beyond what any
 * real site uses. Hitting it fails the send rather than proceeding unverified — see the note on
 * `fetchAllSegments`.
 */
const MAX_LOOKUP_PAGES = 10;

/** Trimmed + lowercased, for case-insensitive exact matching. Never substring. */
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Sweep every page of the site's active segments.
 *
 * One full sweep rather than one `name_contains` request per name: N names would cost N requests
 * and still return substring matches that have to be narrowed, and we need the complete list
 * anyway to build the "did you mean" candidates an error message carries.
 *
 * Any failure here fails the caller. There is deliberately no unverified fallback: the listing
 * can 403 (segment read is a per-user role permission, so a sub-user with send rights but no
 * Audience access gets one) or 5xx, and in every one of those cases proceeding would mean posting
 * references we could not check — the send-to-everyone trap above.
 */
async function fetchAllSegments(client: ApiClient, siteId: number): Promise<Segment[]> {
  const all: Segment[] = [];
  for (let page = 1; page <= MAX_LOOKUP_PAGES; page += 1) {
    const result = await listSegments(client, siteId, { limit: LOOKUP_PAGE_SIZE, page });
    all.push(...result.segments);
    if (!result.has_more) return all;
  }
  throw new ValidationError(
    `This site has more than ${MAX_LOOKUP_PAGES * LOOKUP_PAGE_SIZE} segments, which is more than ` +
      'this tool can verify in one pass. Narrow the audience another way, or create an audience ' +
      'group in the dashboard and send to it with `audience_groups`.',
    { subscriber_filter: 'too many segments to verify' },
  );
}

type SegmentIndex = {
  /** normalized name → segment ids carrying that name (more than one = ambiguous). */
  byName: Map<string, number[]>;
  /** every known active segment id. */
  ids: Set<number>;
  /** display names, for error messages. */
  names: string[];
};

/**
 * Index only the segments that can actually be targeted.
 *
 * `GET /sites/:siteId/segments` is active-only by construction: the service sets
 * `{ ...params, status: active }` with the literal last (pushengage-adonis-node-api,
 * app/Services/Dashboard/Segment.js:187), the repository applies it in its where clause, and the
 * validator strips a `status` query param, so a paused row cannot come back even if one is asked
 * for. The status check below therefore changes nothing today — it is here so the invariant this
 * module depends on is enforced where it is relied upon rather than in another repository, since
 * a paused id reaching the API is scrubbed from the filter and widens the send to everyone.
 *
 * Only a row that explicitly says it is inactive is dropped. A row with no `status` at all is
 * kept: `toLeanSegment` makes the field optional, and treating "absent" as "not active" would
 * empty the index and fail every name on the site — a far worse failure than the one being
 * guarded against. Raised in review of PR #287.
 */
function indexSegments(segments: Segment[]): SegmentIndex {
  const byName = new Map<string, number[]>();
  const ids = new Set<number>();
  const names: string[] = [];
  for (const s of segments) {
    if (s.status !== undefined && s.status !== SEGMENT_STATUS_ACTIVE) continue;
    ids.add(s.segment_id);
    names.push(s.segment_name);
    const key = normalizeName(s.segment_name);
    const existing = byName.get(key);
    if (existing) existing.push(s.segment_id);
    else byName.set(key, [s.segment_id]);
  }
  return { byName, ids, names };
}

/** Up to five names containing the needle, to make "no segment named X" actionable. */
function suggestions(index: SegmentIndex, needle: string): string[] {
  const n = normalizeName(needle);
  return index.names.filter((name) => normalizeName(name).includes(n)).slice(0, 5);
}

/**
 * Resolve one value from a `segments` rule.
 *
 * Strings are names, numbers are IDs, and a digits-only string is NEVER reinterpreted as an ID.
 * Segment names carry no format or uniqueness constraint, so a segment literally named "34" is
 * legal and `"34"` would otherwise be genuinely ambiguous. The rule is positional so that the
 * failure is a clear "no segment named 34" rather than a wrong audience.
 */
function resolveSegmentValue(
  value: string | number | boolean,
  index: SegmentIndex,
  problems: string[],
): number | null {
  if (typeof value === 'number') {
    if (!index.ids.has(value)) {
      problems.push(
        `segment id ${value} does not exist on this site or is not active (a paused segment ` +
          'cannot be targeted)',
      );
      return null;
    }
    return value;
  }

  if (typeof value === 'string') {
    const matches = index.byName.get(normalizeName(value));
    if (!matches || matches.length === 0) {
      const close = suggestions(index, value);
      problems.push(
        `no active segment named "${value}"` +
          (close.length > 0
            ? `. Did you mean: ${close.map((c) => `"${c}"`).join(', ')}?`
            : '. Call pushengage_list_segments to see the available segments.'),
      );
      return null;
    }
    if (matches.length > 1) {
      problems.push(
        `"${value}" matches ${matches.length} segments (ids ${matches.join(', ')}). ` +
          'Pass the numeric segment id instead.',
      );
      return null;
    }
    return matches[0];
  }

  problems.push(`segment values must be names or numeric ids, got ${typeof value}`);
  return null;
}

/**
 * Verify the attribute keys a filter references.
 *
 * Same failure class as segments, one step milder: the API does not scrub attribute rules, so an
 * unknown key is stored and simply matches nobody. The send reports success and reaches zero
 * people. The API team excluded attributes from their own LLM filter vocabulary for exactly this
 * reason; we keep them (they are the most useful targeting dimension a site has) and verify
 * instead.
 */
async function verifyAttributeKeys(
  client: ApiClient,
  siteId: number,
  keys: string[],
  problems: string[],
): Promise<void> {
  const known = new Set<string>();
  let exhausted = false;
  for (let page = 1; page <= MAX_LOOKUP_PAGES; page += 1) {
    const result = await listAttributes(client, siteId, { limit: LOOKUP_PAGE_SIZE, page });
    for (const a of result.attributes) known.add(a.key);
    if (!result.has_more) break;
    exhausted = page === MAX_LOOKUP_PAGES;
  }

  /**
   * The sweep ran out of pages with more still to read, so `known` is incomplete and a real key
   * on a later page would be reported as unknown — a send refused with a message telling the
   * caller to create an attribute that already exists (review of PR #287). Reachable: the
   * enterprise attribute quota is 1000 and extra capacity is purchasable on top of it.
   *
   * Each unresolved key is checked directly instead. `fetchAllSegments` throws in the same
   * situation because an unverified SEGMENT can widen a send to everyone; an unverified attribute
   * only matches nobody, so failing the biggest accounts outright would cost more than it saves.
   */
  if (exhausted) {
    const missing = keys.filter((key) => !known.has(key));
    await Promise.all(
      missing.map(async (key) => {
        const hit = await listAttributes(client, siteId, {
          limit: LOOKUP_PAGE_SIZE,
          page: 1,
          key_contains: key,
        });
        // `key_contains` is a substring match, so confirm the exact key is among the rows.
        if (hit.attributes.some((a) => a.key === key)) known.add(key);
      }),
    );
  }

  for (const key of keys) {
    if (!known.has(key)) {
      const close = [...known]
        .filter((k) => k.toLowerCase().includes(key.toLowerCase()))
        .slice(0, 5);
      problems.push(
        `no subscriber attribute with key "${key}" on this site` +
          (close.length > 0
            ? `. Did you mean: ${close.map((c) => `"${c}"`).join(', ')}?`
            : '. Call pushengage_list_attributes to see the available keys, or create it with pushengage_create_attribute.'),
      );
    }
  }
}

/**
 * Resolve and verify a filter, returning one safe to post.
 *
 * Costs at most one segment sweep and one attribute sweep, and only when the filter actually
 * references those fields — a filter over device and country alone makes no extra request.
 *
 * @throws ValidationError listing every problem found, so the caller can fix them in one turn
 *         rather than discovering them one send at a time.
 */
export async function resolveSubscriberFilter(
  client: ApiClient,
  siteId: number,
  rawFilter: SubscriberFilter,
): Promise<{ filter: SubscriberFilter; date_conversions: FilterDateConversion[] }> {
  // Dates first, and purely: naive values are reinterpreted from the caller's timezone into UTC
  // (which is what a filter date means) and the MCP-only `timezone` key is stripped so it never
  // reaches the body. No network, so a bad date fails before any lookup is paid for.
  const { filter, conversions: dateConversions } = convertFilterDatesToUtc(rawFilter);
  const problems: string[] = [];
  const needsSegments = hasSegmentRule(filter);
  const attrKeys = attributeKeysIn(filter);

  const [segmentIndex] = await Promise.all([
    needsSegments
      ? fetchAllSegments(client, siteId).then(indexSegments)
      : Promise.resolve<SegmentIndex | null>(null),
    attrKeys.length > 0
      ? verifyAttributeKeys(client, siteId, attrKeys, problems)
      : Promise.resolve(),
  ]);

  const resolved: SubscriberFilter = {
    op: filter.op,
    value: filter.value.map((group) =>
      group.map((rule): SubscriberRule => {
        if (rule.field !== 'segments' || !segmentIndex) return rule;
        // `exists` / `not_exists` carry no value, so there is nothing to resolve.
        if (rule.value === undefined) return rule;

        const rawValues = Array.isArray(rule.value) ? rule.value : [rule.value];
        const ids = rawValues
          .map((v) => resolveSegmentValue(v, segmentIndex, problems))
          .filter((id): id is number => id !== null);

        return { ...rule, value: Array.isArray(rule.value) ? ids : ids[0] };
      }),
    ),
  };

  if (problems.length > 0) {
    // No fieldErrors: ValidationError appends them under the message, so passing the same
    // problems again printed every bullet twice (QA P3-2 on PR #287). The field name would also
    // have been wrong half the time — this resolver serves `subscriber_filter` on the send tools
    // and `filter` on pushengage_create_audience_group.
    throw new ValidationError(
      `Could not resolve the audience filter, so nothing was sent:\n` +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
  }

  return { filter: resolved, date_conversions: dateConversions };
}

export const __testing__ = {
  indexSegments,
  normalizeName,
  resolveSegmentValue,
  suggestions,
  MAX_LOOKUP_PAGES,
  LOOKUP_PAGE_SIZE,
};
