// src/notifications/schema.test.ts
import {
  ListNotificationsInputSchema,
  SendAbNotificationInputSchema,
  SendNotificationInputSchema,
  toAbApiBody,
  toApiBody,
  toListNotificationsQuery,
} from './schema';

describe('SendNotificationInputSchema', () => {
  it('accepts the minimal valid input', () => {
    const result = SendNotificationInputSchema.safeParse({
      title: 'Hello',
      message: 'Body',
      url: 'https://example.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = SendNotificationInputSchema.safeParse({ title: 'Hi' });
    expect(result.success).toBe(false);
  });

  it('rejects schedule_date when status is sent', () => {
    const result = SendNotificationInputSchema.safeParse({
      title: 'X',
      message: 'Y',
      url: 'https://example.com',
      status: 'sent',
      schedule_date: '2026-06-01 12:00:00',
    });
    expect(result.success).toBe(false);
  });

  it('requires schedule_date when status is schedule', () => {
    const result = SendNotificationInputSchema.safeParse({
      title: 'X',
      message: 'Y',
      url: 'https://example.com',
      status: 'schedule',
    });
    expect(result.success).toBe(false);
  });
});

describe('toApiBody', () => {
  it('maps minimal input to API body with source=API', () => {
    const body = toApiBody({
      title: 'Hello',
      message: 'World',
      url: 'https://example.com',
      status: 'sent',
    });
    expect(body).toEqual({
      notification_title: 'Hello',
      notification_message: 'World',
      notification_url: 'https://example.com',
      status: 'sent',
      source: 'API',
    });
    expect(body.tags).toBeUndefined();
  });

  it('maps schedule status to scheduled for the API', () => {
    const body = toApiBody({
      title: 'Hello',
      message: 'World',
      url: 'https://example.com',
      status: 'schedule',
      schedule_date: '2026-05-28 10:00:00',
    });
    expect(body.status).toBe('scheduled');
    expect(body.valid_from).toBe('2026-05-28 10:00:00');
  });

  it('maps draft status to sent in the API body', () => {
    const body = toApiBody({
      title: 'Hello',
      message: 'World',
      url: 'https://example.com',
      status: 'draft',
    });
    expect(body.status).toBe('sent');
  });

  it('passes through utm_params, image_url, big_image_url, expire_in, tags', () => {
    const body = toApiBody({
      title: 'a',
      message: 'b',
      url: 'https://example.com',
      status: 'sent',
      image_url: 'https://example.com/i.png',
      big_image_url: 'https://example.com/b.png',
      expire_in: 3600,
      tags: ['promo'],
      utm_params: { enabled: true, utm_source: 'mcp' },
    });
    expect(body.notification_image).toBe('https://example.com/i.png');
    expect(body.big_image).toBe('https://example.com/b.png');
    expect(body.expiry).toBe(3600);
    expect(body.tags).toEqual(['promo']);
    expect(body.utm_params).toEqual({ enabled: true, utm_source: 'mcp' });
  });

  it('passes android_push and ios_push through unchanged', () => {
    const body = toApiBody({
      title: 'a',
      message: 'b',
      url: 'https://example.com',
      status: 'sent',
      android_push: { small_icon: 'ic_stat' },
      ios_push: { badge: 1, sound: 'default' },
    });
    expect(body.android_push).toEqual({ small_icon: 'ic_stat' });
    expect(body.ios_push).toEqual({ badge: 1, sound: 'default' });
  });

  describe('audience_groups (Send to Audience Group)', () => {
    it('emits notification_criteria with the audience.groups shape', () => {
      const body = toApiBody({
        title: 'a',
        message: 'b',
        url: 'https://example.com',
        status: 'sent',
        audience_groups: [12, 34, 56],
      });
      expect(body.notification_criteria).toEqual({ audience: { groups: [12, 34, 56] } });
    });

    it('omits notification_criteria entirely when audience_groups is not set', () => {
      const body = toApiBody({
        title: 'a',
        message: 'b',
        url: 'https://example.com',
        status: 'sent',
      });
      expect(body.notification_criteria).toBeUndefined();
    });
  });

  describe('send_in_subscribers_timezone', () => {
    it('keeps source=API and ignores the toggle for non-scheduled sends', () => {
      // The Zod schema rejects this combination before toApiBody runs, but defending in
      // toApiBody as well ensures we never accidentally tag a non-scheduled send as
      // parent_sub_timezone if someone bypasses the schema (e.g. internal callers).
      const body = toApiBody({
        title: 'a',
        message: 'b',
        url: 'https://example.com',
        status: 'sent',
        send_in_subscribers_timezone: true,
      });
      expect(body.source).toBe('API');
    });

    it('overrides source to parent_sub_timezone when scheduling in subscribers timezone', () => {
      const body = toApiBody({
        title: 'a',
        message: 'b',
        url: 'https://example.com',
        status: 'schedule',
        schedule_date: '2026-06-01 09:00:00',
        send_in_subscribers_timezone: true,
      });
      expect(body.source).toBe('parent_sub_timezone');
      expect(body.status).toBe('scheduled');
      expect(body.valid_from).toBe('2026-06-01 09:00:00');
    });

    it('keeps source=API for a scheduled send without the toggle', () => {
      const body = toApiBody({
        title: 'a',
        message: 'b',
        url: 'https://example.com',
        status: 'schedule',
        schedule_date: '2026-06-01 09:00:00',
      });
      expect(body.source).toBe('API');
    });
  });
});

describe('SendNotificationInputSchema — send_in_subscribers_timezone validation', () => {
  it('accepts the flag when status=schedule', () => {
    const result = SendNotificationInputSchema.safeParse({
      title: 'a',
      message: 'b',
      url: 'https://example.com',
      status: 'schedule',
      schedule_date: '2026-06-01 09:00:00',
      send_in_subscribers_timezone: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects the flag when status=sent (no schedule means no timezone routing)', () => {
    const result = SendNotificationInputSchema.safeParse({
      title: 'a',
      message: 'b',
      url: 'https://example.com',
      status: 'sent',
      send_in_subscribers_timezone: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects the flag when status=draft', () => {
    const result = SendNotificationInputSchema.safeParse({
      title: 'a',
      message: 'b',
      url: 'https://example.com',
      status: 'draft',
      send_in_subscribers_timezone: true,
    });
    expect(result.success).toBe(false);
  });

  it('accepts false explicitly with any status', () => {
    const r1 = SendNotificationInputSchema.safeParse({
      title: 'a',
      message: 'b',
      url: 'https://example.com',
      status: 'sent',
      send_in_subscribers_timezone: false,
    });
    expect(r1.success).toBe(true);
  });
});

describe('SendNotificationInputSchema — audience_groups validation', () => {
  it('accepts a single audience group id', () => {
    const result = SendNotificationInputSchema.safeParse({
      title: 'a',
      message: 'b',
      url: 'https://example.com',
      audience_groups: [42],
    });
    expect(result.success).toBe(true);
  });

  it('accepts up to 20 audience group ids', () => {
    const result = SendNotificationInputSchema.safeParse({
      title: 'a',
      message: 'b',
      url: 'https://example.com',
      audience_groups: Array.from({ length: 20 }, (_, i) => i + 1),
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty audience_groups array', () => {
    const result = SendNotificationInputSchema.safeParse({
      title: 'a',
      message: 'b',
      url: 'https://example.com',
      audience_groups: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 20 audience group ids', () => {
    const result = SendNotificationInputSchema.safeParse({
      title: 'a',
      message: 'b',
      url: 'https://example.com',
      audience_groups: Array.from({ length: 21 }, (_, i) => i + 1),
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive audience group ids', () => {
    const result = SendNotificationInputSchema.safeParse({
      title: 'a',
      message: 'b',
      url: 'https://example.com',
      audience_groups: [0],
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// A/B notifications
// =============================================================================

const minimalAbInput = {
  variant_a: {
    title: 'A title',
    message: 'A body',
    url: 'https://example.com/a',
  },
  variant_b: {
    title: 'B title',
    message: 'B body',
    url: 'https://example.com/b',
  },
};

const fullIntelligentConfig = {
  sent_limit: 10000,
  sent_limit_percentage: 10,
  winner_delay_minutes: 240,
};

describe('SendAbNotificationInputSchema', () => {
  it('accepts the minimal valid A/B input (no intelligent_ab_test)', () => {
    const result = SendAbNotificationInputSchema.safeParse(minimalAbInput);
    expect(result.success).toBe(true);
  });

  it('accepts intelligent_ab_test when fully specified', () => {
    const result = SendAbNotificationInputSchema.safeParse({
      ...minimalAbInput,
      intelligent_ab_test: fullIntelligentConfig,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing variant_b', () => {
    const result = SendAbNotificationInputSchema.safeParse({
      variant_a: minimalAbInput.variant_a,
    });
    expect(result.success).toBe(false);
  });

  it('rejects partial intelligent_ab_test (missing winner_delay_minutes)', () => {
    const result = SendAbNotificationInputSchema.safeParse({
      ...minimalAbInput,
      intelligent_ab_test: { sent_limit: 5000, sent_limit_percentage: 20 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects sent_limit_percentage > 99', () => {
    const result = SendAbNotificationInputSchema.safeParse({
      ...minimalAbInput,
      intelligent_ab_test: { ...fullIntelligentConfig, sent_limit_percentage: 100 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects winner_delay_minutes > 10080', () => {
    const result = SendAbNotificationInputSchema.safeParse({
      ...minimalAbInput,
      intelligent_ab_test: { ...fullIntelligentConfig, winner_delay_minutes: 10081 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects schedule_date when status is sent', () => {
    const result = SendAbNotificationInputSchema.safeParse({
      ...minimalAbInput,
      status: 'sent',
      schedule_date: '2026-06-01 12:00:00',
    });
    expect(result.success).toBe(false);
  });

  it('requires schedule_date when status is schedule', () => {
    const result = SendAbNotificationInputSchema.safeParse({
      ...minimalAbInput,
      status: 'schedule',
    });
    expect(result.success).toBe(false);
  });
});

describe('toAbApiBody', () => {
  it('maps plain A/B input (no intelligent_ab_test) without execution_state', () => {
    const body = toAbApiBody({
      ...minimalAbInput,
      status: 'sent',
    });

    expect(body.A).toEqual({
      notification_title: 'A title',
      notification_message: 'A body',
      notification_url: 'https://example.com/a',
    });
    expect(body.B).toEqual({
      notification_title: 'B title',
      notification_message: 'B body',
      notification_url: 'https://example.com/b',
    });
    expect(body.status).toBe('sent');
    expect(body).not.toHaveProperty('source');
    // Intelligent A/B is opt-in — execution_state must be absent when not requested,
    // otherwise the Adonis validator would require params.sent_limit + abc.*.
    expect(body.execution_state).toBeUndefined();
    // No optionals leaked
    expect(body.tags).toBeUndefined();
    expect(body.valid_from).toBeUndefined();
    expect(body.notification_criteria).toBeUndefined();
  });

  it('emits execution_state when intelligent_ab_test is provided', () => {
    const body = toAbApiBody({
      ...minimalAbInput,
      status: 'sent',
      intelligent_ab_test: fullIntelligentConfig,
    });
    expect(body.execution_state).toEqual({
      params: { sent_limit: 10000 },
      abc: { sent_limit_percentage: 10, winner_delay: 240 },
    });
  });

  it('schedule status maps to "scheduled" with valid_from', () => {
    const body = toAbApiBody({
      ...minimalAbInput,
      status: 'schedule',
      schedule_date: '2026-06-01 09:00:00',
    });
    expect(body.status).toBe('scheduled');
    expect(body.valid_from).toBe('2026-06-01 09:00:00');
  });

  it('renames winner_delay_minutes -> winner_delay in the API body', () => {
    const body = toAbApiBody({
      ...minimalAbInput,
      status: 'sent',
      intelligent_ab_test: { ...fullIntelligentConfig, winner_delay_minutes: 1440 },
    });
    expect(body.execution_state?.abc.winner_delay).toBe(1440);
    // Make sure the MCP-facing key did not leak through.
    expect(
      (body.execution_state?.abc as Record<string, unknown> | undefined)?.winner_delay_minutes,
    ).toBeUndefined();
  });

  it('forwards per-variant image_url, big_image_url, expire_in into the API names', () => {
    const body = toAbApiBody({
      ...minimalAbInput,
      status: 'sent',
      variant_a: {
        ...minimalAbInput.variant_a,
        image_url: 'https://example.com/a-icon.png',
        big_image_url: 'https://example.com/a-hero.png',
        expire_in: 3600,
      },
      variant_b: {
        ...minimalAbInput.variant_b,
        image_url: 'https://example.com/b-icon.png',
      },
    });
    expect(body.A.notification_image).toBe('https://example.com/a-icon.png');
    expect(body.A.big_image).toBe('https://example.com/a-hero.png');
    expect(body.A.expiry).toBe(3600);
    expect(body.B.notification_image).toBe('https://example.com/b-icon.png');
    expect(body.B.big_image).toBeUndefined();
    expect(body.B.expiry).toBeUndefined();
  });

  it('includes result_name in execution_state when intelligent_ab_test.result_name is set', () => {
    const body = toAbApiBody({
      ...minimalAbInput,
      status: 'sent',
      intelligent_ab_test: { ...fullIntelligentConfig, result_name: 'Headline test #4' },
    });
    expect(body.execution_state?.result_name).toBe('Headline test #4');
  });

  describe('audience_groups (Send to Audience Group)', () => {
    it('emits notification_criteria with the audience.groups shape', () => {
      const body = toAbApiBody({
        ...minimalAbInput,
        status: 'sent',
        audience_groups: [12, 34],
      });
      expect(body.notification_criteria).toEqual({ audience: { groups: [12, 34] } });
    });

    it('omits notification_criteria when audience_groups is not set', () => {
      const body = toAbApiBody({
        ...minimalAbInput,
        status: 'sent',
      });
      expect(body.notification_criteria).toBeUndefined();
    });
  });
});

describe('SendAbNotificationInputSchema — audience_groups validation', () => {
  it('accepts audience_groups on A/B notifications', () => {
    const result = SendAbNotificationInputSchema.safeParse({
      ...minimalAbInput,
      audience_groups: [12, 34],
    });
    expect(result.success).toBe(true);
  });

  it('rejects > 20 audience group ids on A/B notifications', () => {
    const result = SendAbNotificationInputSchema.safeParse({
      ...minimalAbInput,
      audience_groups: Array.from({ length: 21 }, (_, i) => i + 1),
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// Recurring notifications (folded into pushengage_send_notification via `recurring_schedule`)
// =============================================================================

const minimalRecurringInput = {
  title: 'Weekly digest',
  message: 'This week on our blog',
  url: 'https://example.com/blog',
  recurring_schedule: {
    days: ['monday', 'wednesday', 'friday'] as Array<'monday' | 'wednesday' | 'friday'>,
    times: ['09:00'],
    start_date: '2026-05-26',
    end_date: '2026-06-26',
  },
};

describe('SendNotificationInputSchema — recurring_schedule', () => {
  it('accepts a recurring notification with no status (defaults to sent)', () => {
    const result = SendNotificationInputSchema.safeParse(minimalRecurringInput);
    expect(result.success).toBe(true);
  });

  it('accepts a recurring notification with status="draft"', () => {
    const result = SendNotificationInputSchema.safeParse({
      ...minimalRecurringInput,
      status: 'draft',
    });
    expect(result.success).toBe(true);
  });

  it('rejects recurring_schedule combined with status="schedule"', () => {
    const result = SendNotificationInputSchema.safeParse({
      ...minimalRecurringInput,
      status: 'schedule',
      schedule_date: '2026-05-28 10:00:00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects recurring_schedule combined with schedule_date', () => {
    const result = SendNotificationInputSchema.safeParse({
      ...minimalRecurringInput,
      schedule_date: '2026-05-28 10:00:00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects recurring_schedule combined with send_in_subscribers_timezone', () => {
    const result = SendNotificationInputSchema.safeParse({
      ...minimalRecurringInput,
      send_in_subscribers_timezone: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty days array', () => {
    const result = SendNotificationInputSchema.safeParse({
      ...minimalRecurringInput,
      recurring_schedule: { ...minimalRecurringInput.recurring_schedule, days: [] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown day name', () => {
    const result = SendNotificationInputSchema.safeParse({
      ...minimalRecurringInput,
      recurring_schedule: {
        ...minimalRecurringInput.recurring_schedule,
        days: ['Monday'],
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts both HH:mm and HH:mm:ss times', () => {
    const result = SendNotificationInputSchema.safeParse({
      ...minimalRecurringInput,
      recurring_schedule: {
        ...minimalRecurringInput.recurring_schedule,
        times: ['09:00', '17:30:45'],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects malformed time of day', () => {
    const result = SendNotificationInputSchema.safeParse({
      ...minimalRecurringInput,
      recurring_schedule: { ...minimalRecurringInput.recurring_schedule, times: ['9am'] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects end_date before start_date', () => {
    const result = SendNotificationInputSchema.safeParse({
      ...minimalRecurringInput,
      recurring_schedule: {
        ...minimalRecurringInput.recurring_schedule,
        start_date: '2026-06-01',
        end_date: '2026-05-01',
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts end_date equal to start_date (single-day recurrence)', () => {
    const result = SendNotificationInputSchema.safeParse({
      ...minimalRecurringInput,
      recurring_schedule: {
        ...minimalRecurringInput.recurring_schedule,
        start_date: '2026-06-01',
        end_date: '2026-06-01',
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('toApiBody — recurring_schedule branch', () => {
  it('emits source=repeat_scheduled and sche_options instead of valid_from', () => {
    const body = toApiBody({
      ...minimalRecurringInput,
      status: 'sent',
    });

    // status is ALWAYS 'sent' in the request body for recurring — API flips to
    // 'repeat_scheduled' internally on save. action=sent activates the recurrence.
    expect(body.status).toBe('sent');
    expect(body.source).toBe('repeat_scheduled');
    expect(body.valid_from).toBeUndefined();
    expect(body.sche_options).toEqual({
      schedule_days: ['monday', 'wednesday', 'friday'],
      schedule_time: ['09:00:00'], // HH:mm input padded to HH:mm:ss
      schedule_start_date: '2026-05-26',
      schedule_end_date: '2026-06-26',
    });
    // Outer key is the abbreviated `sche_options`, not `schedule_options`.
    expect((body as Record<string, unknown>).schedule_options).toBeUndefined();
  });

  it('keeps body.status="sent" even when input status is "draft" (action query param carries draft)', () => {
    const body = toApiBody({
      ...minimalRecurringInput,
      status: 'draft',
    });
    expect(body.status).toBe('sent');
    expect(body.source).toBe('repeat_scheduled');
    expect(body.sche_options).toBeDefined();
  });

  it('passes HH:mm:ss inputs through unchanged', () => {
    const body = toApiBody({
      ...minimalRecurringInput,
      status: 'sent',
      recurring_schedule: {
        ...minimalRecurringInput.recurring_schedule,
        times: ['17:30:45'],
      },
    });
    expect(body.sche_options?.schedule_time).toEqual(['17:30:45']);
  });

  it('forwards audience_groups -> notification_criteria alongside recurring schedule', () => {
    const body = toApiBody({
      ...minimalRecurringInput,
      status: 'sent',
      audience_groups: [12, 34],
    });
    expect(body.source).toBe('repeat_scheduled');
    expect(body.sche_options).toBeDefined();
    expect(body.notification_criteria).toEqual({ audience: { groups: [12, 34] } });
  });
});

describe('ListNotificationsInputSchema', () => {
  it('applies defaults (limit=10, page=1, status=all, include_analytics=false)', () => {
    const result = ListNotificationsInputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.page).toBe(1);
      expect(result.data.status).toBe('all');
      expect(result.data.include_analytics).toBe(false);
    }
  });

  it('rejects limit > 100', () => {
    expect(ListNotificationsInputSchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it('rejects an unknown status value', () => {
    expect(ListNotificationsInputSchema.safeParse({ status: 'sending' }).success).toBe(false);
  });

  it('accepts a paired sent_after/sent_before range', () => {
    const result = ListNotificationsInputSchema.safeParse({
      sent_after: '2026-01-01',
      sent_before: '2026-06-30',
    });
    expect(result.success).toBe(true);
  });

  it('rejects sent_after without sent_before', () => {
    expect(ListNotificationsInputSchema.safeParse({ sent_after: '2026-01-01' }).success).toBe(
      false,
    );
  });

  it('rejects sent_before without sent_after', () => {
    expect(ListNotificationsInputSchema.safeParse({ sent_before: '2026-06-30' }).success).toBe(
      false,
    );
  });

  it('rejects sent_before earlier than sent_after', () => {
    const result = ListNotificationsInputSchema.safeParse({
      sent_after: '2026-06-30',
      sent_before: '2026-01-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects sent_after earlier than 2017-07-01', () => {
    const result = ListNotificationsInputSchema.safeParse({
      sent_after: '2016-12-31',
      sent_before: '2026-01-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-calendar date format', () => {
    const result = ListNotificationsInputSchema.safeParse({
      sent_after: '2026-01-01 10:00:00',
      sent_before: '2026-06-30',
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 5 tags', () => {
    const result = ListNotificationsInputSchema.safeParse({
      tags: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(result.success).toBe(false);
  });
});

describe('toListNotificationsQuery', () => {
  const parse = (raw: Record<string, unknown>) => ListNotificationsInputSchema.parse(raw);

  it('omits the status filter for "all"', () => {
    const query = toListNotificationsQuery(parse({}));
    expect(query).toEqual({ limit: 10, page: 1 });
  });

  it('forwards a concrete status', () => {
    expect(toListNotificationsQuery(parse({ status: 'scheduled' })).status).toBe('scheduled');
  });

  it('maps sent_after/sent_before -> start_sent_at/end_sent_at', () => {
    const query = toListNotificationsQuery(
      parse({ sent_after: '2026-01-01', sent_before: '2026-06-30' }),
    );
    expect(query.start_sent_at).toBe('2026-01-01');
    expect(query.end_sent_at).toBe('2026-06-30');
  });

  it('comma-joins tags and maps exclude_tags -> tags_exclude', () => {
    const query = toListNotificationsQuery(
      parse({ tags: ['sale', 'promo'], exclude_tags: ['test'] }),
    );
    expect(query.tags).toBe('sale,promo');
    expect(query.tags_exclude).toBe('test');
  });

  it('maps include_analytics -> expand=notification_analytics,result_analytics', () => {
    expect(toListNotificationsQuery(parse({ include_analytics: true })).expand).toBe(
      'notification_analytics,result_analytics',
    );
    expect(toListNotificationsQuery(parse({})).expand).toBeUndefined();
  });
});
