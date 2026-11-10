// src/dashboardUrl.ts
//
// Links back into the dashboard, for the `view_url` every create/send tool returns.
//
// These used to be hand-built per tool as `${dashboard_url}/sites/<siteId>/<thing>/<id>`. That
// route does not exist — every one of them opened the dashboard's "page moved or deleted" screen
// (QA P2-1 on PR #287). The real paths come from `pushengage-app/src/routes/routes.ts`:
//
//   editNotification   '/campaigns/notifications/edit/:id'
//   notifications      '/campaigns/notifications'
//   editSegment        '/audience/segments/edit/:id'
//   editAudienceGroup  '/audience/audience-groups/edit/:id'
//   attributes         '/audience/attributes'
//
// A path being IN that table is not enough — check it has a `<Route>` in MainAppRoutes.tsx and
// that the app navigates to it. `viewSegment: '/audience/segments/:id'` is declared and has
// neither, which is how this file first shipped a segment link that 404s (QA N1).
//
// THE DASHBOARD HAS NO SITE SEGMENT IN ITS URLS. The active site comes from the site picker in
// the dashboard's own state, and no route or query parameter selects one — grepping the app for a
// `site_id` search param turns up nothing. So a link can address the right PAGE but not the right
// SITE: opened while the picker sits on another site it lands on that site's equivalent page, or
// 404s on an id that site does not own. That is still strictly better than a URL that is
// guaranteed to fail, but it is why `view_url` stays documented as best-effort, and why the tools
// that return it also return the id.
//
// If the dashboard ever gains site-scoped routes, this is the one file to change.

/**
 * True when an id is not usable in a link. `0` counts: `normalizeAbCreateResponse` falls back to
 * `notification_id: variantA.notification_id ?? 0` when the API omits it, and `/edit/0` is a
 * 404 — the list page is the honest answer instead.
 */
function isMissingId(id?: number | string | null): boolean {
  return id === undefined || id === null || id === '' || id === 0 || id === '0';
}

/** Join a dashboard base URL and an app path without doubling or dropping the slash. */
function join(base: string, path: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

/**
 * A notification, by id. Falls back to the list when the API did not return one, which beats
 * emitting a URL ending in `/edit/undefined`.
 */
export function notificationUrl(dashboardUrl: string, notificationId?: number | string): string {
  return isMissingId(notificationId)
    ? join(dashboardUrl, '/campaigns/notifications')
    : join(dashboardUrl, `/campaigns/notifications/edit/${notificationId}`);
}

/**
 * A segment's edit page, by id.
 *
 * The route table also declares `viewSegment: '/audience/segments/:id'`, which is what this used
 * to build — but that path has NO `<Route>` anywhere in the app and nothing links to it, so it
 * renders the "page moved or deleted" screen (QA N1 on PR #287). `editSegment` is the one the
 * dashboard itself navigates to from its segment list
 * (`routes.editAudienceSegment`, wired at MainAppRoutes.tsx:392).
 */
export function segmentUrl(dashboardUrl: string, segmentId?: number | string): string {
  return isMissingId(segmentId)
    ? join(dashboardUrl, '/audience/segments')
    : join(dashboardUrl, `/audience/segments/edit/${segmentId}`);
}

/** An audience group's edit page, by id. The dashboard has no read-only view for these. */
export function audienceGroupUrl(dashboardUrl: string, groupId?: number | string): string {
  return isMissingId(groupId)
    ? join(dashboardUrl, '/audience/audience-groups')
    : join(dashboardUrl, `/audience/audience-groups/edit/${groupId}`);
}

/** The attributes list. There is no per-attribute page in the dashboard. */
export function attributesUrl(dashboardUrl: string): string {
  return join(dashboardUrl, '/audience/attributes');
}
