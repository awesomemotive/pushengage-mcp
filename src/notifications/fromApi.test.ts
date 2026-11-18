// src/notifications/fromApi.test.ts
import { SendNotificationInputSchema, toApiBody } from './schema';
import {
  applyReplayedFields,
  describeSavedAudience,
  flattenAbRead,
  dropConflictingSchedule,
  notificationToSendInput,
  recurringStartDateIssue,
  whyNotDeletable,
  whyNotEditable,
  whyNotResendable,
} from './fromApi';

/** A scheduled notification as the API reads it back, trimmed to the fields that round-trip. */
const SCHEDULED = {
  notification_id: 169007291,
  notification_title: 'Weekend sale',
  notification_message: '30% off everything',
  notification_url: 'https://example.com/sale',
  status: 'scheduled',
  source: 'API',
  // Already the SITE's wall clock on read (moment.utcToLocal), which is how the write side reads
  // schedule_date — so this must survive untouched.
  valid_from: '2026-12-01 09:00:00',
  // The API's own column names; the previous fixture used the MCP's input names, so it agreed
  // with the mapper's bug instead of catching it (review of PR #290).
  notification_image: 'https://example.com/icon.png',
  big_image: 'https://example.com/hero.png',
  expiry: 86400,
  tags: ['sale'],
  actions: [{ label: 'Shop', url: 'https://example.com/shop', image_url: 'https://e.com/i.png' }],
  utm_params: { enabled: true, utm_source: 'pushengage' },
};

describe('notificationToSendInput', () => {
  it('reconstructs a scheduled notification as create-shaped input', () => {
    const out = notificationToSendInput(SCHEDULED);
    expect(out).toMatchObject({
      title: 'Weekend sale',
      message: '30% off everything',
      url: 'https://example.com/sale',
      status: 'schedule',
      schedule_date: '2026-12-01 09:00:00',
      image_url: 'https://example.com/icon.png',
      big_image_url: 'https://example.com/hero.png',
      expire_in: 86400,
      tags: ['sale'],
    });
    expect(out.actions).toEqual([
      { label: 'Shop', url: 'https://example.com/shop', image_url: 'https://e.com/i.png' },
    ]);
  });

  /**
   * The whole point of the round trip: what comes back has to satisfy the create schema, or an
   * edit cannot be expressed as "replay the notification with one field changed".
   */
  it('produces something the create schema accepts, so an edit can replay it', () => {
    const merged = SendNotificationInputSchema.safeParse({
      ...notificationToSendInput(SCHEDULED),
      title: 'Weekend sale — final hours',
    });
    expect(merged.success).toBe(true);
    if (merged.success) {
      expect(merged.data.title).toBe('Weekend sale — final hours');
      // Untouched fields must survive, or the update would clear them.
      expect(merged.data.big_image_url).toBe('https://example.com/hero.png');
      expect(merged.data.schedule_date).toBe('2026-12-01 09:00:00');
    }
  });

  it('maps the stored status vocabulary onto the write one', () => {
    expect(notificationToSendInput({ ...SCHEDULED, status: 'draft' }).status).toBe('draft');
    expect(notificationToSendInput({ ...SCHEDULED, status: 'scheduled' }).status).toBe('schedule');
    // A recurrence is written as a normal send carrying sche_options.
    expect(notificationToSendInput({ ...SCHEDULED, status: 'repeat_scheduled' }).status).toBe(
      'sent',
    );
  });

  it('keeps audience group ids and drops the display-only group_list', () => {
    const out = notificationToSendInput({
      ...SCHEDULED,
      notification_criteria: {
        audience: { groups: [12, 34], group_list: [{ id: 12, name: 'VIPs' }] },
      },
    });
    expect(out.audience_groups).toEqual([12, 34]);
    expect(JSON.stringify(out)).not.toContain('group_list');
  });

  it('keeps segment ids in a filter and drops the display-only segment_list', () => {
    const out = notificationToSendInput({
      ...SCHEDULED,
      notification_criteria: {
        filter: {
          op: 'or',
          value: [
            [
              {
                field: 'segments',
                op: 'in',
                value: [12],
                segment_list: [{ segment_id: 12, segment_name: 'Sports Fans' }],
              },
            ],
          ],
        },
      },
    });
    expect(out.subscriber_filter).toEqual({
      op: 'or',
      value: [[{ field: 'segments', op: 'in', value: [12] }]],
    });
    expect(JSON.stringify(out)).not.toContain('segment_list');
  });

  it('rebuilds a recurrence and drops schedule_date, which cannot accompany it', () => {
    const out = notificationToSendInput({
      ...SCHEDULED,
      status: 'repeat_scheduled',
      source: 'repeat_scheduled',
      sche_options: {
        schedule_days: ['monday', 'friday'],
        schedule_time: ['09:00'],
        schedule_start_date: '2026-12-01',
        schedule_end_date: '2026-12-31',
      },
    });
    expect(out.recurring_schedule).toEqual({
      days: ['monday', 'friday'],
      times: ['09:00'],
      start_date: '2026-12-01',
      end_date: '2026-12-31',
    });
    expect(out.schedule_date).toBeUndefined();
    expect(SendNotificationInputSchema.safeParse(out).success).toBe(true);
  });

  it('carries subscriber-timezone delivery back as the boolean input', () => {
    const out = notificationToSendInput({
      ...SCHEDULED,
      source: 'parent_sub_timezone',
      notification_criteria: { tz_scheduled_time: '2026-12-01 09:00:00' },
    });
    expect(out.send_in_subscribers_timezone).toBe(true);
    expect(SendNotificationInputSchema.safeParse(out).success).toBe(true);
  });

  it('omits fields the read does not carry rather than inventing them', () => {
    const out = notificationToSendInput({
      notification_title: 'Bare',
      notification_message: 'Minimal',
      notification_url: 'https://example.com',
      status: 'draft',
    });
    expect(out.big_image_url).toBeUndefined();
    expect(out.actions).toBeUndefined();
    expect(out.audience_groups).toBeUndefined();
    expect(out.subscriber_filter).toBeUndefined();
  });
});

/**
 * The point of the whole feature: a draft is a notification you finish later, so promoting one to
 * a real send has to work through the same merge as any other edit. `toApiBody` then turns
 * status 'sent' into `action=sent` on the PATCH, which is what actually dispatches it.
 */
describe('promoting a draft', () => {
  const DRAFT = {
    notification_title: 'Half-finished',
    notification_message: 'Body text',
    notification_url: 'https://example.com',
    status: 'draft',
    source: 'API',
    notification_image: 'https://example.com/icon.png',
    notification_criteria: { audience: { groups: [12], group_list: [{ id: 12, name: 'VIPs' }] } },
  };

  it('is editable in the first place', () => {
    expect(whyNotEditable(DRAFT)).toBeNull();
  });

  it('sends now when status is overridden to "sent", keeping the rest of the draft', () => {
    const merged = SendNotificationInputSchema.parse({
      ...notificationToSendInput(DRAFT),
      status: 'sent',
    });
    expect(merged.status).toBe('sent');
    expect(merged.title).toBe('Half-finished');
    // The audience the draft was built with has to survive, or promoting it would send to
    // everyone.
    expect(merged.audience_groups).toEqual([12]);
    expect(toApiBody(merged).status).toBe('sent');
  });

  it('schedules when status is overridden to "schedule" with a date', () => {
    const merged = SendNotificationInputSchema.parse({
      ...notificationToSendInput(DRAFT),
      status: 'schedule',
      schedule_date: '2026-12-01 09:00:00',
    });
    expect(toApiBody(merged).status).toBe('scheduled');
    expect(toApiBody(merged).valid_from).toBe('2026-12-01 09:00:00');
  });

  it('still refuses to schedule without a date', () => {
    const result = SendNotificationInputSchema.safeParse({
      ...notificationToSendInput(DRAFT),
      status: 'schedule',
    });
    expect(result.success).toBe(false);
  });
});

describe('whyNotEditable', () => {
  it('allows drafts, scheduled and recurring notifications', () => {
    for (const status of ['draft', 'scheduled', 'repeat_scheduled', 'pause_repeat_scheduled']) {
      expect(whyNotEditable({ status, source: 'API' })).toBeNull();
    }
  });

  /**
   * The API does not refuse this one — it reads an update with no `A` key as "remove the A/B
   * test" and DELETES the B and C notifications. Refusing here is the only thing standing
   * between "change the title" and a destroyed test.
   */
  it('refuses every part of an A/B test, because the API would break it', () => {
    const reason = whyNotEditable({ status: 'scheduled', source: 'A' });
    expect(reason).toContain('delete the other variant');
    expect(reason).toContain('pushengage_send_ab_notification');
    // 'C' is the intelligent-A/B variant. 'B' is a READ-side value — the transformer rewrites a B
    // variant's source to 'B' (Transformers/Dashboard/Notification/index.js:253) — so editing one
    // through the generic path would rewrite its source to API and detach it from its test.
    // Raised in review of PR #290.
    for (const source of ['B', 'C']) {
      expect(whyNotEditable({ status: 'scheduled', source })).not.toBeNull();
    }
  });

  it('refuses a sent notification and points at sending a new one', () => {
    expect(whyNotEditable({ status: 'sent', source: 'API' })).toContain('already been sent');
    expect(whyNotEditable({ status: 'sending', source: 'API' })).not.toBeNull();
  });

  it('explains a subscriber-timezone parent separately from a plain sent one', () => {
    // Its status flips to `sent` up to 14 hours before the first timezone is due, so "already
    // sent" would read as wrong to someone whose send is still in the future.
    const reason = whyNotEditable({ status: 'sent', source: 'parent_sub_timezone' });
    expect(reason).toContain('14 hours');
    expect(reason).not.toContain('already been sent and cannot');
  });

  it('refuses RSS auto-push notifications, as the API does', () => {
    expect(whyNotEditable({ status: 'scheduled', source: 'rss_feed' })).toContain('RSS');
  });

  it('refuses an unknown or archived status rather than trying', () => {
    expect(whyNotEditable({ status: 'archive', source: 'API' })).toContain('cannot be edited');
    expect(whyNotEditable({ status: '', source: 'API' })).toContain('(unknown)');
  });
});

describe('recurringStartDateIssue', () => {
  /**
   * The trap this exists for: a recurrence that is already running has a start date in the past,
   * and the API rejects an update whose start date is not still in the future
   * (Validators/Dashboard/Controllers/Notification/index.js:110). Replaying it unchanged — which
   * is what editing any OTHER field does — would fail with a message about a date the caller
   * never touched.
   */
  it('flags a replayed start date that has already passed', () => {
    const issue = recurringStartDateIssue('2026-11-01', false, '2026-11-11');
    expect(issue).toContain('2026-11-01');
    expect(issue).toContain('start_date of today or later');
  });

  it('says nothing when the caller is setting the recurrence themselves', () => {
    expect(recurringStartDateIssue('2026-11-01', true, '2026-11-11')).toBeNull();
  });

  it('says nothing for a start date today or later, leaving the edge to the API', () => {
    // The API knows the site timezone and compares end-of-day, so today is its call, not ours.
    expect(recurringStartDateIssue('2026-11-11', false, '2026-11-11')).toBeNull();
    expect(recurringStartDateIssue('2026-12-01', false, '2026-11-11')).toBeNull();
  });

  it('says nothing when there is no recurrence at all', () => {
    expect(recurringStartDateIssue(undefined, false, '2026-11-11')).toBeNull();
  });
});

describe('whyNotDeletable', () => {
  it('allows the same statuses an edit allows', () => {
    for (const status of ['draft', 'scheduled', 'repeat_scheduled', 'pause_repeat_scheduled']) {
      expect(whyNotDeletable({ status, source: 'API' })).toBeNull();
    }
  });

  // Unlike editing, deleting an A/B test IS supported by the API — it removes the whole pair.
  it('allows an A/B test, which the API deletes as a pair', () => {
    expect(whyNotDeletable({ status: 'scheduled', source: 'A' })).toBeNull();
  });

  it('refuses a sent notification because the delivery record is kept', () => {
    expect(whyNotDeletable({ status: 'sent', source: 'API' })).toContain('delivery record');
  });

  it('points a subscriber-timezone broadcast at Cancel Scheduled instead', () => {
    expect(whyNotDeletable({ status: 'sent', source: 'parent_sub_timezone' })).toContain(
      'Cancel Scheduled',
    );
  });

  it('refuses RSS, as the API does', () => {
    expect(whyNotDeletable({ status: 'scheduled', source: 'rss_feed' })).toContain('RSS');
  });
});

describe('whyNotResendable', () => {
  it('is the mirror image of editing: only a sent notification qualifies', () => {
    expect(whyNotResendable({ status: 'sent', source: 'API' })).toBeNull();
    expect(whyNotResendable({ status: 'sending', source: 'API' })).toBeNull();
  });

  it('refuses a draft and points at the tool that can send it', () => {
    const reason = whyNotResendable({ status: 'draft', source: 'API' });
    expect(reason).toContain('pushengage_update_notification');
    expect(reason).toContain('status="sent"');
  });

  it('refuses a scheduled notification, naming its state', () => {
    expect(whyNotResendable({ status: 'scheduled', source: 'API' })).toContain('"scheduled"');
  });

  it('refuses subscriber-timezone sends, as the API does', () => {
    expect(whyNotResendable({ status: 'sent', source: 'parent_sub_timezone' })).toContain(
      'cannot be resent',
    );
  });
});

/**
 * Every case here is a defect found in review of PR #290. They are grouped because they share one
 * cause: the reconstruction has to satisfy the create schema's cross-field rules, and those rules
 * are stricter than the API's.
 */
describe('review findings on the reconstruction', () => {
  it("reads the images from the API's own column names", () => {
    // notification_image / big_image, not the MCP's image_url / big_image_url. Reading the wrong
    // names found nothing, so an edit reset the icon to the site default and nulled the big image.
    const out = notificationToSendInput({
      notification_title: 'T',
      notification_message: 'M',
      notification_url: 'https://example.com',
      status: 'draft',
      notification_image: 'https://example.com/icon.png',
      big_image: 'https://example.com/hero.png',
    });
    expect(out.image_url).toBe('https://example.com/icon.png');
    expect(out.big_image_url).toBe('https://example.com/hero.png');
  });

  it('keeps a recurring draft a draft, instead of starting the recurrence', () => {
    const out = notificationToSendInput({
      notification_title: 'T',
      notification_message: 'M',
      notification_url: 'https://example.com',
      status: 'draft',
      source: 'repeat_scheduled',
      sche_options: {
        schedule_days: ['monday'],
        schedule_time: ['09:00'],
        schedule_start_date: '2026-12-01',
        schedule_end_date: '2026-12-31',
      },
    });
    expect(out.status).toBe('draft');
    expect(SendNotificationInputSchema.safeParse(out).success).toBe(true);
  });

  it('does not set the subscriber-timezone flag on a draft, which the schema forbids', () => {
    const out = notificationToSendInput({
      notification_title: 'T',
      notification_message: 'M',
      notification_url: 'https://example.com',
      status: 'draft',
      source: 'parent_sub_timezone',
    });
    expect(out.send_in_subscribers_timezone).toBeUndefined();
    // Before the fix this reconstruction failed validation, so EVERY edit of such a draft errored.
    expect(SendNotificationInputSchema.safeParse(out).success).toBe(true);
  });
});

describe('dropConflictingSchedule', () => {
  const scheduled = {
    title: 'T',
    message: 'M',
    url: 'https://example.com',
    status: 'schedule' as const,
    schedule_date: '2026-12-01 09:00:00',
  };

  /** "Send this scheduled notification now" has to work; it failed on the replayed date. */
  it('clears the replayed schedule_date when the caller sends now', () => {
    const merged = { ...dropConflictingSchedule(scheduled, { status: 'sent' }), status: 'sent' };
    expect(merged.schedule_date).toBeUndefined();
    expect(SendNotificationInputSchema.safeParse(merged).success).toBe(true);
  });

  /**
   * Moving something back to a draft KEEPS its time — a draft of a scheduled send is a real state,
   * and the schema permits the pairing. This test used to be named "clears it", which stopped
   * being true and would have mislead the next reader.
   */
  it('keeps the date when the caller moves it back to a draft', () => {
    const merged = { ...dropConflictingSchedule(scheduled, { status: 'draft' }), status: 'draft' };
    expect(merged.schedule_date).toBe('2026-12-01 09:00:00');
    expect(SendNotificationInputSchema.safeParse(merged).success).toBe(true);
  });

  /**
   * The case asked for in review: a DATED DRAFT edited by title alone. `dropConflictingSchedule`
   * used to clear the date for any status that was not `schedule`, so a draft lost its time one
   * step after the reconstruction had carefully preserved it.
   */
  it('keeps a dated draft intact when only the title changes', () => {
    const datedDraft = {
      title: 'T',
      message: 'M',
      url: 'https://example.com',
      status: 'draft' as const,
      schedule_date: '2026-12-01 09:00:00',
      send_in_subscribers_timezone: true,
    };
    const out = dropConflictingSchedule(datedDraft, { title: 'New' });
    expect(out.schedule_date).toBe('2026-12-01 09:00:00');
    expect(out.send_in_subscribers_timezone).toBe(true);
    expect(SendNotificationInputSchema.safeParse({ ...out, title: 'New' }).success).toBe(true);
  });

  it('clears the one-shot fields when the caller adds a recurrence', () => {
    const recurrence = {
      days: ['monday'],
      times: ['09:00'],
      start_date: '2026-12-01',
      end_date: '2026-12-31',
    };
    const merged = {
      ...dropConflictingSchedule(scheduled, { recurring_schedule: recurrence }),
      recurring_schedule: recurrence,
    };
    expect(merged.schedule_date).toBeUndefined();
    expect(SendNotificationInputSchema.safeParse(merged).success).toBe(true);
  });

  it('leaves a date the caller passed alone', () => {
    const out = dropConflictingSchedule(scheduled, {
      status: 'schedule',
      schedule_date: '2027-01-01 10:00:00',
    });
    expect(out.schedule_date).toBe('2026-12-01 09:00:00');
  });

  it('touches nothing when the caller changes neither status nor recurrence', () => {
    expect(dropConflictingSchedule(scheduled, { title: 'New' })).toEqual(scheduled);
  });
});

describe('sources the API will not act on', () => {
  /**
   * These return `notification not found` from the API rather than a refusal, because the delete
   * and resend services fetch with a source allowlist. Caught here so the message says what is
   * actually wrong. Raised in review of PR #290.
   */
  it('refuses a lone A/B variant for delete and resend', () => {
    for (const source of ['B', 'C']) {
      expect(whyNotDeletable({ status: 'scheduled', source })).toContain('one variant');
      expect(whyNotResendable({ status: 'sent', source })).toContain('one variant');
    }
  });

  it('still allows an A/B parent, which the controller routes to the A/B service', () => {
    expect(whyNotDeletable({ status: 'scheduled', source: 'A' })).toBeNull();
    expect(whyNotResendable({ status: 'sent', source: 'A' })).toBeNull();
  });

  it('refuses drip, triggered and single-timezone copies with their own reasons', () => {
    expect(whyNotDeletable({ status: 'draft', source: 'Drip' })).toContain('drip campaign');
    expect(whyNotDeletable({ status: 'draft', source: 'Trigger' })).toContain('triggered campaign');
    expect(whyNotResendable({ status: 'sent', source: 'sub_timezone' })).toContain(
      "one timezone's copy",
    );
  });

  it('allows the sources the API does look up', () => {
    for (const source of ['API', 'Dashboard', 'dashboard', 'zapier', 'repeat_scheduled']) {
      expect(whyNotDeletable({ status: 'draft', source })).toBeNull();
    }
    expect(whyNotDeletable({ status: 'draft', source: 'wordPress-5.2' })).toBeNull();
  });
});

describe('drafts keep their schedule (counter-review of PR #290)', () => {
  const DATED_DRAFT = {
    notification_title: 'T',
    notification_message: 'M',
    notification_url: 'https://example.com',
    status: 'draft',
    valid_from: '2026-12-01 09:00:00',
  };

  /**
   * My first answer here was wrong. The API does keep a draft's date: the dashboard posts
   * `status: scheduled` with `valid_from` under `?action=draft`, the formatter stores the date in
   * its `case schedule` branch, and the draft block afterwards overrides only the status and sent
   * date (app/Formatters/Dashboard/Notification.js:379-383). So the row stays a draft AND keeps
   * its time.
   */
  it('keeps the date on a plain draft', () => {
    const out = notificationToSendInput(DATED_DRAFT);
    expect(out.status).toBe('draft');
    expect(out.schedule_date).toBe('2026-12-01 09:00:00');
    const body = toApiBody(SendNotificationInputSchema.parse(out));
    // Sent as `scheduled` so the formatter stores valid_from; `action=draft` forces it back.
    expect(body.status).toBe('scheduled');
    expect(body.valid_from).toBe('2026-12-01 09:00:00');
  });

  it('keeps the subscriber-timezone mode on a dated draft', () => {
    const out = notificationToSendInput({ ...DATED_DRAFT, source: 'parent_sub_timezone' });
    expect(out.send_in_subscribers_timezone).toBe(true);
    expect(toApiBody(SendNotificationInputSchema.parse(out)).source).toBe('parent_sub_timezone');
  });

  it('does not replay the zero date as if it were a real time', () => {
    const out = notificationToSendInput({ ...DATED_DRAFT, valid_from: '0000-00-00 00:00:00' });
    expect(out.schedule_date).toBeUndefined();
    expect(out.send_in_subscribers_timezone).toBeUndefined();
  });

  it('will not leave a subscriber-timezone draft without a time', () => {
    // That time is what each subscriber receives it at, so it cannot be dropped.
    const result = SendNotificationInputSchema.safeParse({
      title: 'T',
      message: 'M',
      url: 'https://example.com',
      status: 'draft',
      send_in_subscribers_timezone: true,
    });
    expect(result.success).toBe(false);
  });
});

describe('wordpress source matching (counter-review of PR #290)', () => {
  // The constant is `wordPress` but its VALUE is `wordpress`, and the API matches it with a SQL
  // LIKE that ignores case. Comparing against the camelCase spelling refused real WordPress
  // notifications outright -- and the original test used `wordPress-5.2`, so it agreed with the bug.
  it('accepts the real lowercase value for delete and resend', () => {
    for (const source of ['wordpress', 'wordpress-5.2', 'WordPress', 'wordPress']) {
      expect(whyNotDeletable({ status: 'draft', source })).toBeNull();
      expect(whyNotResendable({ status: 'sent', source })).toBeNull();
    }
  });
});

describe('source is preserved on edit (counter-review of PR #290)', () => {
  /**
   * The pipeline is deliberately two steps: the parse strips unknown keys, so `source` and
   * `mobile_push` are re-applied to the finished body. Asserting against `toApiBody` alone hid
   * that — an earlier attempt to carry them inside it did nothing at all.
   */
  const edit = (raw: Record<string, unknown>) => {
    const reconstructed = notificationToSendInput(raw);
    return applyReplayedFields(
      toApiBody(SendNotificationInputSchema.parse(reconstructed)),
      reconstructed,
    );
  };

  const made = (source: string) => ({
    notification_title: 'T',
    notification_message: 'M',
    notification_url: 'https://example.com',
    status: 'draft',
    source,
  });

  it('replays a dashboard, Zapier or WordPress origin instead of relabelling it API', () => {
    for (const [stored, expected] of [
      ['Dashboard', 'Dashboard'],
      ['zapier', 'zapier'],
      ['wordpress', 'wordpress'],
      ['wordpress-5.2', 'wordpress'],
    ]) {
      expect(edit(made(stored)).source).toBe(expected);
    }
  });

  it('falls back to API for a value the validator would reject', () => {
    // `dashboard` (the legacy dashboard1 value) is not in the upsert enum, so replaying it
    // would 422.
    expect(edit(made('dashboard')).source).toBe('API');
  });

  it('re-applies mobile_push, which the parse also strips', () => {
    const body = edit({ ...made('Dashboard'), mobile_push: { android: { sound: 'default' } } });
    expect(body.mobile_push).toEqual({ android: { sound: 'default' } });
  });

  it('still lets the delivery mode win, since source is its only carrier', () => {
    expect(
      edit({
        ...made('Dashboard'),
        status: 'sent',
        sche_options: {
          schedule_days: ['monday'],
          schedule_time: ['09:00'],
          schedule_start_date: '2026-12-01',
          schedule_end_date: '2026-12-31',
        },
      }).source,
    ).toBe('repeat_scheduled');

    expect(
      edit({
        ...made('zapier'),
        source: 'parent_sub_timezone',
        status: 'scheduled',
        valid_from: '2026-12-01 09:00:00',
      }).source,
    ).toBe('parent_sub_timezone');
  });

  it('leaves a create at API, since nothing is replayed there', () => {
    const body = toApiBody(
      SendNotificationInputSchema.parse({
        title: 'T',
        message: 'M',
        url: 'https://example.com',
        status: 'sent',
      }),
    );
    expect(body.source).toBe('API');
  });
});

/**
 * The pipeline the update tool actually runs, end to end: reconstruct → drop conflicts → parse →
 * build body → re-apply replayed fields.
 *
 * This exists because every piece above was tested in isolation and still composed into a bug:
 * `notificationToSendInput` kept a draft's date and `dropConflictingSchedule` then cleared it,
 * because the latter treated everything that was not `schedule` as unable to carry one. Both unit
 * suites passed. Only running them together showed it.
 */
describe('the whole edit pipeline', () => {
  const editWith = (raw: Record<string, unknown>, overrides: Record<string, unknown> = {}) => {
    const base = dropConflictingSchedule(
      notificationToSendInput(raw),
      overrides as Parameters<typeof dropConflictingSchedule>[1],
    );
    return applyReplayedFields(
      toApiBody(SendNotificationInputSchema.parse({ ...base, ...overrides })),
      base,
    );
  };

  const SCHEDULED = {
    notification_title: 'T',
    notification_message: 'M',
    notification_url: 'https://example.com',
    status: 'scheduled',
    source: 'Dashboard',
    valid_from: '2026-12-01 09:00:00',
    notification_image: 'https://example.com/icon.png',
    big_image: 'https://example.com/hero.png',
    mobile_push: { android: { sound: 'default' } },
    notification_criteria: {
      audience: { groups: [12], group_list: [{ id: 12, name: 'VIPs' }] },
    },
  };

  it('carries everything untouched through a title-only edit', () => {
    const body = editWith(SCHEDULED, { title: 'New title' });
    expect(body).toMatchObject({
      notification_title: 'New title',
      notification_image: 'https://example.com/icon.png',
      big_image: 'https://example.com/hero.png',
      status: 'scheduled',
      valid_from: '2026-12-01 09:00:00',
      source: 'Dashboard',
      notification_criteria: { audience: { groups: [12] } },
    });
    expect(body.mobile_push).toEqual({ android: { sound: 'default' } });
  });

  it('keeps a dated draft dated, through both steps', () => {
    const body = editWith({ ...SCHEDULED, status: 'draft' });
    expect(body.valid_from).toBe('2026-12-01 09:00:00');
    expect(body.status).toBe('scheduled');
  });

  it('keeps a subscriber-timezone draft in that mode, through both steps', () => {
    const body = editWith({ ...SCHEDULED, status: 'draft', source: 'parent_sub_timezone' });
    expect(body.source).toBe('parent_sub_timezone');
    expect(body.valid_from).toBe('2026-12-01 09:00:00');
  });

  it('still clears the replayed date when the caller sends now', () => {
    const body = editWith(SCHEDULED, { status: 'sent' });
    expect(body.status).toBe('sent');
    expect(body.valid_from).toBeUndefined();
  });
});

describe('A/B parents read back nested (review of PR #290)', () => {
  /**
   * `GET /notifications/:id` answers `{ ab, A, B }` for a source-`A` notification, not a flat row.
   * Read flat, `source` and `status` are undefined, so every A/B path reported `status
   * "(unknown)"` and delete and resend refused a parent the API supports. Every A/B fixture in
   * this file was a flat `{ status, source: 'A' }`, which is why none of it showed.
   */
  const NESTED = {
    ab: { id: 9001, status: 'sent' },
    A: {
      notification_id: 500,
      notification_title: 'Variant A',
      notification_message: 'M',
      notification_url: 'https://example.com',
      notification_image: 'https://example.com/a.png',
    },
    B: { notification_id: 501, notification_title: 'Variant B' },
  };

  it('flattens to the A variant with the pair status', () => {
    const flat = flattenAbRead(NESTED);
    expect(flat.notification_title).toBe('Variant A');
    expect(flat.status).toBe('sent');
    expect(flat.source).toBe('A');
    expect(flat.ab_notification_id).toBe(9001);
  });

  it('leaves a flat notification untouched', () => {
    const flat = { notification_title: 'T', status: 'draft', source: 'API' };
    expect(flattenAbRead(flat)).toEqual(flat);
  });

  it('gives the A/B explanation on edit, not "(unknown)"', () => {
    const reason = whyNotEditable(flattenAbRead(NESTED));
    expect(reason).toContain('A/B test');
    expect(reason).not.toContain('(unknown)');
  });

  it('allows delete and resend of the parent, which the API supports', () => {
    const flat = flattenAbRead(NESTED);
    expect(whyNotResendable(flat)).toBeNull();
    expect(
      whyNotDeletable(flattenAbRead({ ...NESTED, ab: { id: 9001, status: 'scheduled' } })),
    ).toBeNull();
  });

  it('reconstructs enough to duplicate, which needs a title', () => {
    const out = notificationToSendInput(flattenAbRead(NESTED));
    expect(out.title).toBe('Variant A');
    expect(out.image_url).toBe('https://example.com/a.png');
  });
});

describe('fields the API rebuilds from the body (review of PR #290)', () => {
  const raw = {
    notification_title: 'T',
    notification_message: 'M',
    notification_url: 'https://example.com',
    status: 'scheduled',
    valid_from: '2026-12-01 09:00:00',
    execution_state: { params: { sent_limit: 500 }, result_name: 'signup' },
    interaction: 0,
  };

  it('carries execution_state, so a sample limit is not wiped by an edit', () => {
    const out = notificationToSendInput(raw);
    const body = applyReplayedFields(toApiBody(SendNotificationInputSchema.parse(out)), out);
    expect(body.execution_state).toEqual({ params: { sent_limit: 500 }, result_name: 'signup' });
  });

  it('carries require_interaction=0, which the validator would otherwise default back to 1', () => {
    const out = notificationToSendInput(raw);
    expect(out.interaction).toBe(0);
    const body = applyReplayedFields(toApiBody(SendNotificationInputSchema.parse(out)), out);
    expect(body.interaction).toBe(0);
  });

  it('does not let a replayed execution_state override one the body built', () => {
    const out = notificationToSendInput(raw);
    const body = applyReplayedFields(
      { ...toApiBody(SendNotificationInputSchema.parse(out)), execution_state: { built: true } },
      out,
    );
    expect(body.execution_state).toEqual({ built: true });
  });
});

describe('edit refuses sources the API would silently relabel (review of PR #290)', () => {
  // `updateNotification` has no source allowlist, so these are not refused upstream -- they are
  // saved with `source: 'API'`, which for a timezone child detaches it from its parent.
  it('refuses a single-timezone child, a drip and a shopify notification', () => {
    expect(whyNotEditable({ status: 'scheduled', source: 'sub_timezone' })).toContain(
      "one timezone's copy",
    );
    expect(whyNotEditable({ status: 'draft', source: 'Drip' })).toContain('drip campaign');
    expect(whyNotEditable({ status: 'draft', source: 'shopify' })).not.toBeNull();
  });

  it('still allows the ordinary sources', () => {
    for (const source of ['API', 'Dashboard', 'zapier', 'wordpress', 'repeat_scheduled']) {
      expect(whyNotEditable({ status: 'draft', source })).toBeNull();
    }
  });
});

describe("recurring start date is judged in the site's own calendar (QA F2 on PR #290)", () => {
  // `today` is now the SITE's date, which is the calendar the API compares against. The earlier
  // version compared against a UTC date with a day of slack; a recurrence that started YESTERDAY
  // slipped past it to the API, which answered with the raw validation error this replaces. The
  // cases either side of this one are covered by the describe above.
  it('refuses a recurrence that started yesterday', () => {
    expect(recurringStartDateIssue('2026-11-10', false, '2026-11-11')).toContain(
      'started on 2026-11-10',
    );
  });
});

describe('describeSavedAudience reports what the API saved (QA F1 on PR #290)', () => {
  it('names the audience groups the API kept', () => {
    expect(
      describeSavedAudience({ audience: { op: 'or', groups: [4779, 4780] } }, [4779, 4780]),
    ).toEqual({ audience: 'audience groups: 4779, 4780' });
  });

  it('reports all subscribers, and the loss, when no group survived', () => {
    const result = describeSavedAudience({}, [4780]);
    expect(result.audience).toContain('all subscribers');
    expect(result.audience).toContain('4780');
    expect(result.dropped_audience_groups).toEqual([4780]);
  });

  it('reports a custom filter as targeting, not as a criteria key', () => {
    expect(describeSavedAudience({ filter: { op: 'or', value: [[]] } }, undefined)).toEqual({
      audience: 'custom audience filter',
    });
  });

  it('ignores the subscriber-timezone bookkeeping that rides in the same object', () => {
    expect(
      describeSavedAudience({ timezone: 330, tz_scheduled_time: '2026-11-12 09:00:00' }, undefined),
    ).toEqual({ audience: 'all subscribers' });
  });

  it('falls back to the request when the response carries no criteria at all', () => {
    expect(describeSavedAudience(undefined, [12])).toEqual({ audience: 'audience groups: 12' });
    expect(describeSavedAudience(undefined, undefined)).toEqual({ audience: 'all subscribers' });
  });

  it('never claims a loss it cannot see: a partial drop echoes every id back', () => {
    // formatAudienceGroup returns the ids it was given whenever at least one resolves, so this
    // is all the response can honestly say.
    expect(describeSavedAudience({ audience: { groups: [1, 2] } }, [1, 2])).toEqual({
      audience: 'audience groups: 1, 2',
    });
  });
});
