// src/notifications/api.test.ts
import { __testing__ } from './api';

const { adaptNotificationsEnvelope, toLeanNotification } = __testing__;

const row = (overrides: Record<string, unknown> = {}) => ({
  notification_id: 101,
  notification_title: 'Summer sale',
  notification_message: '50% off everything',
  notification_url: 'https://example.com/sale',
  status: 'sent',
  source: 'API',
  sent_at: '2026-07-01 09:00:00',
  created_at: '2026-06-30 18:00:00',
  sentcount: 1200,
  viewcount: 800,
  clickcount: 90,
  failedcount: 3,
  ctr: 11.25,
  tags: ['sale'],
  ...overrides,
});

describe('toLeanNotification', () => {
  it('maps a full row to the lean MCP shape', () => {
    const lean = toLeanNotification(row());
    expect(lean).toEqual({
      notification_id: 101,
      title: 'Summer sale',
      message: '50% off everything',
      url: 'https://example.com/sale',
      status: 'sent',
      source: 'API',
      sent_at: '2026-07-01 09:00:00',
      created_at: '2026-06-30 18:00:00',
      sent_count: 1200,
      view_count: 800,
      click_count: 90,
      unsubscribe_count: 3,
      ctr: 11.25,
      tags: ['sale'],
    });
  });

  it('drops rows missing notification_id or notification_title', () => {
    expect(toLeanNotification(row({ notification_id: undefined }))).toBeNull();
    expect(toLeanNotification(row({ notification_title: undefined }))).toBeNull();
  });

  it('omits the zero-date placeholders on unsent rows', () => {
    const lean = toLeanNotification(
      row({ status: 'draft', sent_at: '0000-00-00 00:00:00', valid_from: '0000-00-00 00:00:00' }),
    );
    expect(lean?.sent_at).toBeUndefined();
    expect(lean?.schedule_date).toBeUndefined();
  });

  it('surfaces valid_from as schedule_date for scheduled rows', () => {
    const lean = toLeanNotification(
      row({ status: 'scheduled', valid_from: '2026-08-01 10:00:00' }),
    );
    expect(lean?.schedule_date).toBe('2026-08-01 10:00:00');
  });

  it('coerces numeric-string counters', () => {
    const lean = toLeanNotification(row({ notification_id: '7', sentcount: '42' }));
    expect(lean?.notification_id).toBe(7);
    expect(lean?.sent_count).toBe(42);
  });

  it('maps notification_image/big_image -> image_url/big_image_url, omitting empty strings', () => {
    const lean = toLeanNotification(
      row({ notification_image: 'https://cdn.example.com/icon.png', big_image: '' }),
    );
    expect(lean?.image_url).toBe('https://cdn.example.com/icon.png');
    expect(lean?.big_image_url).toBeUndefined();
  });

  it('surfaces action buttons as label/url pairs, dropping per-button icons and malformed entries', () => {
    const lean = toLeanNotification(
      row({
        actions: [
          {
            label: 'Shop now',
            url: 'https://example.com/shop',
            image_url: 'https://cdn.example.com/a.png',
          },
          { label: 'Broken' },
        ],
      }),
    );
    expect(lean?.actions).toEqual([{ label: 'Shop now', url: 'https://example.com/shop' }]);
  });

  it('omits actions when the row has none', () => {
    expect(toLeanNotification(row())?.actions).toBeUndefined();
    expect(toLeanNotification(row({ actions: [] }))?.actions).toBeUndefined();
  });

  it('surfaces utm_params, dropping empty values', () => {
    const lean = toLeanNotification(
      row({
        utm_params: {
          enabled: true,
          utm_source: 'pushengage',
          utm_medium: 'push',
          utm_campaign: '',
        },
      }),
    );
    expect(lean?.utm_params).toEqual({
      enabled: true,
      utm_source: 'pushengage',
      utm_medium: 'push',
    });
  });

  it('omits utm_params when the row carries none', () => {
    expect(toLeanNotification(row())?.utm_params).toBeUndefined();
    expect(toLeanNotification(row({ utm_params: {} }))?.utm_params).toBeUndefined();
  });

  it('flattens audience criteria into audience_groups with names from group_list', () => {
    const lean = toLeanNotification(
      row({
        notification_criteria: {
          audience: {
            groups: [42, 99],
            group_list: [{ id: 42, name: 'Gold customers' }],
          },
        },
      }),
    );
    expect(lean?.criteria).toEqual({
      audience_groups: [{ id: 42, name: 'Gold customers' }, { id: 99 }],
    });
  });

  it('passes the custom-targeting filter and timezone fields through', () => {
    const filter = { op: 'or', value: [[{ field: 'country', op: 'in', value: ['US'] }]] };
    const lean = toLeanNotification(
      row({
        notification_criteria: {
          filter,
          timezone: '+05:30',
          tz_scheduled_time: '2026-08-01 09:00:00',
        },
      }),
    );
    expect(lean?.criteria).toEqual({
      filter,
      timezone: '+05:30',
      tz_scheduled_time: '2026-08-01 09:00:00',
    });
  });

  it('omits criteria when empty or absent (all-subscribers send)', () => {
    expect(toLeanNotification(row())?.criteria).toBeUndefined();
    expect(toLeanNotification(row({ notification_criteria: {} }))?.criteria).toBeUndefined();
    expect(
      toLeanNotification(row({ notification_criteria: { audience: { groups: [] } } }))?.criteria,
    ).toBeUndefined();
  });

  it('sums the per-goal result map into goal_count/goal_value', () => {
    const lean = toLeanNotification(
      row({
        result: {
          purchase: { count: 3, value: 120 },
          signup: { count: '2', value: '10' },
        },
      }),
    );
    expect(lean?.goal_count).toBe(5);
    expect(lean?.goal_value).toBe(130);
  });

  it('omits goal fields when the result map is empty or absent', () => {
    expect(toLeanNotification(row())?.goal_count).toBeUndefined();
    const lean = toLeanNotification(row({ result: {} }));
    expect(lean?.goal_count).toBeUndefined();
    expect(lean?.goal_value).toBeUndefined();
  });
});

describe('adaptNotificationsEnvelope', () => {
  it('handles a paginated envelope', () => {
    const result = adaptNotificationsEnvelope(
      {
        data: [row(), row({ notification_id: 102 })],
        total: 12,
        perPage: 10,
        page: 1,
        lastPage: 2,
      },
      1,
      10,
    );
    expect(result.notifications).toHaveLength(2);
    expect(result.total).toBe(12);
    expect(result.last_page).toBe(2);
    expect(result.has_more).toBe(true);
  });

  it('reports has_more=false on the last page', () => {
    const result = adaptNotificationsEnvelope(
      { data: [row()], total: 11, perPage: 10, page: 2, lastPage: 2 },
      2,
      10,
    );
    expect(result.has_more).toBe(false);
  });

  it('handles a bare array fallback', () => {
    const result = adaptNotificationsEnvelope([row()], 1, 10);
    expect(result.notifications).toHaveLength(1);
    expect(result.page).toBe(1);
    expect(result.has_more).toBe(false);
  });

  it('infers has_more=true when no lastPage but the page is full', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ notification_id: i + 1 }));
    const result = adaptNotificationsEnvelope(rows, 1, 10);
    expect(result.has_more).toBe(true);
  });

  it('filters rows missing required fields', () => {
    const result = adaptNotificationsEnvelope(
      { data: [row(), { status: 'sent' }], total: 2, perPage: 10, page: 1, lastPage: 1 },
      1,
      10,
    );
    expect(result.notifications).toHaveLength(1);
  });

  it('returns an empty page for unrecognized shapes', () => {
    const result = adaptNotificationsEnvelope({ unexpected: true }, 3, 25);
    expect(result.notifications).toEqual([]);
    expect(result.page).toBe(3);
    expect(result.limit).toBe(25);
    expect(result.has_more).toBe(false);
  });
});
