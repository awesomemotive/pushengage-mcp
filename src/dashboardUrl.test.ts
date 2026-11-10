// src/dashboardUrl.test.ts
import { attributesUrl, audienceGroupUrl, notificationUrl, segmentUrl } from './dashboardUrl';

const BASE = 'https://app.pushengage.com';

describe('dashboard links', () => {
  // These paths are copied from pushengage-app/src/routes/routes.ts. If the dashboard changes
  // them, this suite is what should fail.
  it('matches the dashboard route table', () => {
    expect(notificationUrl(BASE, 169007291)).toBe(
      'https://app.pushengage.com/campaigns/notifications/edit/169007291',
    );
    expect(segmentUrl(BASE, 144197)).toBe(
      'https://app.pushengage.com/audience/segments/edit/144197',
    );
    expect(audienceGroupUrl(BASE, 4750)).toBe(
      'https://app.pushengage.com/audience/audience-groups/edit/4750',
    );
    expect(attributesUrl(BASE)).toBe('https://app.pushengage.com/audience/attributes');
  });

  // QA N1 on PR #287: '/audience/segments/:id' is in the route table but has no <Route>, so it
  // renders the "page moved or deleted" screen. Only the edit path is wired.
  it('uses the segment edit path, which is the one the dashboard itself navigates to', () => {
    expect(segmentUrl(BASE, 7)).toContain('/audience/segments/edit/7');
    expect(segmentUrl(BASE, 7)).not.toMatch(/\/audience\/segments\/7$/);
  });

  it('never emits the old /sites/<id>/ prefix', () => {
    // The shape QA found 404ing on every link (P2-1 on PR #287).
    for (const url of [
      notificationUrl(BASE, 1),
      segmentUrl(BASE, 1),
      audienceGroupUrl(BASE, 1),
      attributesUrl(BASE),
    ]) {
      expect(url).not.toContain('/sites/');
    }
  });

  it('falls back to the list page when the API returned no id', () => {
    expect(notificationUrl(BASE, undefined)).toBe(
      'https://app.pushengage.com/campaigns/notifications',
    );
    expect(segmentUrl(BASE, undefined)).toBe('https://app.pushengage.com/audience/segments');
    expect(audienceGroupUrl(BASE, undefined)).toBe(
      'https://app.pushengage.com/audience/audience-groups',
    );
    // An empty string reached here too, via the old `created.id ?? ''` fallbacks.
    expect(segmentUrl(BASE, '')).toBe('https://app.pushengage.com/audience/segments');
    // And 0, via `normalizeAbCreateResponse`'s `variantA.notification_id ?? 0`. `/edit/0` is a
    // 404, so the list page is the honest fallback.
    expect(notificationUrl(BASE, 0)).toBe('https://app.pushengage.com/campaigns/notifications');
    expect(segmentUrl(BASE, 0)).toBe('https://app.pushengage.com/audience/segments');
    expect(audienceGroupUrl(BASE, 0)).toBe('https://app.pushengage.com/audience/audience-groups');
    for (const url of [notificationUrl(BASE), segmentUrl(BASE), audienceGroupUrl(BASE)]) {
      expect(url).not.toContain('undefined');
      expect(url.endsWith('/')).toBe(false);
    }
  });

  it('tolerates a trailing slash on the configured dashboard URL', () => {
    expect(notificationUrl('https://app.pushengage.com/', 7)).toBe(
      'https://app.pushengage.com/campaigns/notifications/edit/7',
    );
    expect(attributesUrl('https://staging.example.com/')).toBe(
      'https://staging.example.com/audience/attributes',
    );
  });
});
