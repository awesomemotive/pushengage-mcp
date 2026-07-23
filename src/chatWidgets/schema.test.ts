// src/chatWidgets/schema.test.ts
import { ListChatWidgetsInputSchema, toChatWidget } from './schema';

describe('ListChatWidgetsInputSchema', () => {
  it('defaults page=1, limit=10, status=all', () => {
    const result = ListChatWidgetsInputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(10);
      expect(result.data.status).toBe('all');
    }
  });

  it('rejects limit > 100 and unknown status', () => {
    expect(ListChatWidgetsInputSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(ListChatWidgetsInputSchema.safeParse({ status: 'enabled' }).success).toBe(false);
  });
});

describe('toChatWidget', () => {
  it('maps status, channels (with custom name), devices, business hours, and targeting', () => {
    const widget = toChatWidget({
      id: 5,
      name: 'Support widget',
      status: 'enabled',
      created_at: '2026-05-01 10:00:00',
      updated_at: '2026-06-01 12:00:00',
      config: {
        show_on: ['desktop', 'mobile'],
        channels: [
          { type: 'whatsapp', value: '123' },
          { type: 'email', value: 'a@b.com' },
          { type: 'custom', channel_name: 'Help Center' },
        ],
        behavior: {
          display_rules: {
            business_hours: { enabled: true },
            rule_groups: [
              {
                rules: [
                  { type: 'country', op: 'in', value: ['US', 'IN', 'US'] },
                  { type: 'url', op: 'contains', value: '/pricing' },
                ],
              },
            ],
          },
        },
      },
    });

    expect(widget).toEqual({
      id: 5,
      name: 'Support widget',
      status: 'Active',
      status_code: 'enabled',
      channel_count: 3,
      channels: ['WhatsApp', 'Email', 'Custom Link - Help Center'],
      devices: ['Desktop', 'Mobile'],
      business_hours: true,
      country_targeting: { mode: 'include', countries: ['US', 'IN'] },
      page_targeting: 'rules_applied',
      created_at: '2026-05-01 10:00:00',
      updated_at: '2026-06-01 12:00:00',
    });
  });

  it('exclude (nin) country rule -> exclude mode', () => {
    const widget = toChatWidget({
      id: 1,
      status: 'disabled',
      config: {
        behavior: {
          display_rules: {
            rule_groups: [{ rules: [{ type: 'country', op: 'nin', value: ['CN'] }] }],
          },
        },
      },
    });
    expect(widget.status).toBe('Inactive');
    expect(widget.country_targeting).toEqual({ mode: 'exclude', countries: ['CN'] });
    expect(widget.page_targeting).toBe('all');
  });

  it('degrades gracefully when config is missing', () => {
    expect(toChatWidget({ id: 2, name: 'Bare', status: 'enabled' })).toEqual({
      id: 2,
      name: 'Bare',
      status: 'Active',
      status_code: 'enabled',
      channel_count: 0,
      channels: [],
      devices: [],
      business_hours: false,
      country_targeting: { mode: 'all', countries: [] },
      page_targeting: 'all',
      created_at: '',
      updated_at: '',
    });
  });

  it('treats a bare boolean business_hours as the flag', () => {
    const widget = toChatWidget({
      config: { behavior: { display_rules: { business_hours: true } } },
    });
    expect(widget.business_hours).toBe(true);
  });
});
