// src/notifications/schema.ts
import { z } from 'zod';

// Limits mirror the API's text-length caps.
const MAX_TITLE_LENGTH = 85;
const MAX_MESSAGE_LENGTH = 135;
const MIN_EXPIRE_IN_SECONDS = 60;
const MAX_EXPIRE_IN_SECONDS = 2419200; // 28 days
const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 36;
/** Matches the API's standard datetime format: YYYY-MM-DD HH:mm:ss in the site timezone. */
const API_DATETIME_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

const ApiDateTimeSchema = z
  .string()
  .regex(API_DATETIME_REGEX, 'Must be YYYY-MM-DD HH:mm:ss (site timezone)');

const ActionSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  image_url: z.string().url().optional(),
});

const UtmParamsSchema = z.object({
  enabled: z.boolean(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_term: z.string().optional(),
  utm_content: z.string().optional(),
});

const AndroidPushActionButtonSchema = z.object({
  url: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().url().optional(),
});

const AndroidPushSchema = z.object({
  action_buttons: z.array(AndroidPushActionButtonSchema).min(1).max(2).optional(),
  small_icon: z.string().optional(),
  large_icon: z.string().optional(),
  big_picture: z.string().optional(),
  channel_id: z.number().int().positive().optional(),
  deep_link: z.string().optional(),
  group_key: z.string().optional(),
  accent_color: z.string().optional(),
});

const IosPushActionButtonSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

const IosPushSchema = z.object({
  action_buttons: z.array(IosPushActionButtonSchema).min(1).max(2).optional(),
  deep_link: z.string().optional(),
  badge: z.number().int().min(0).optional(),
  badge_increment: z.number().int().min(1).optional(),
  category: z.string().optional(),
  content_available: z.union([z.literal(0), z.literal(1)]).optional(),
  media: z.string().optional(),
  sound: z.string().optional(),
  thread_id: z.string().optional(),
});

// -- Recurring-schedule helpers (used by SendNotificationInputSchema below) -----

const WEEKDAY_VALUES = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

/** Matches HH:mm or HH:mm:ss (24h). The :ss part is optional; we normalize on the way out. */
const TIME_OF_DAY_REGEX = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
/** Matches YYYY-MM-DD (calendar date only — no time component). */
const CALENDAR_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const RecurringScheduleSchema = z
  .object({
    days: z
      .array(z.enum(WEEKDAY_VALUES))
      .min(1)
      .describe(
        'Days of the week to send on. Values are lowercase day names. At least one day required.',
      ),
    times: z
      .array(z.string().regex(TIME_OF_DAY_REGEX, 'Must be HH:mm or HH:mm:ss (24-hour)'))
      .min(1)
      .max(100)
      .describe(
        'Times of day to send (24-hour). HH:mm or HH:mm:ss accepted. e.g. ["09:00", "17:30"]. At least one, up to 100.',
      ),
    start_date: z
      .string()
      .regex(CALENDAR_DATE_REGEX, 'Must be YYYY-MM-DD')
      .describe('First date the recurrence is active. Format: YYYY-MM-DD (site timezone).'),
    end_date: z
      .string()
      .regex(CALENDAR_DATE_REGEX, 'Must be YYYY-MM-DD')
      .describe(
        'Last date the recurrence is active. Format: YYYY-MM-DD. Must be on or after start_date.',
      ),
  })
  .refine((s) => s.end_date >= s.start_date, {
    message: 'end_date must be on or after start_date',
    path: ['end_date'],
  });

/** The API requires HH:mm:ss; we accept HH:mm and pad with :00. */
function normalizeTimeOfDay(t: string): string {
  return t.length === 5 ? `${t}:00` : t;
}

// The MCP SDK introspects `inputSchema` to build the JSON Schema the LLM sees. It can only
// enumerate properties on a plain ZodObject — `.superRefine()` returns a ZodEffects, which
// emits `properties: {}` (empty). So we split: `SendNotificationInputObject` is the plain
// object (registered as `inputSchema`), and `SendNotificationInputSchema` adds cross-field
// rules and is parsed again in the tool handler.
export const SendNotificationInputObject = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).describe('Notification title'),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH).describe('Notification message body'),
  url: z.string().url().describe('Destination URL when the subscriber clicks the notification'),
  status: z
    .enum(['sent', 'schedule', 'draft'])
    .default('sent')
    .describe('Send now (sent), schedule for later (schedule), or save without sending (draft)'),
  schedule_date: ApiDateTimeSchema.optional().describe(
    'Required when status is "schedule". Format: YYYY-MM-DD HH:mm:ss in the site timezone.',
  ),
  site_id: z.number().int().positive().optional().describe('Override the currently selected site'),
  image_url: z
    .string()
    .url()
    .optional()
    .describe('Small notification icon. Only when the user explicitly asks for an image.'),
  big_image_url: z
    .string()
    .url()
    .optional()
    .describe('Large hero image. Only when the user explicitly asks for a big image.'),
  expire_in: z
    .number()
    .int()
    .min(MIN_EXPIRE_IN_SECONDS)
    .max(MAX_EXPIRE_IN_SECONDS)
    .optional()
    .describe('Expiry in seconds (60–2419200). Only when the user explicitly asks.'),
  tags: z
    .array(z.string().trim().min(1).max(MAX_TAG_LENGTH))
    .max(MAX_TAGS)
    .optional()
    .describe('Up to 5 tags, 36 chars each. Only when the user explicitly asks for tags.'),
  actions: z
    .array(ActionSchema)
    .min(1)
    .max(2)
    .optional()
    .describe('Action buttons. Only when the user explicitly asks.'),
  utm_params: UtmParamsSchema.optional().describe(
    'UTM tracking params. Only when the user explicitly asks.',
  ),
  audience_groups: z
    .array(z.number().int().positive())
    .min(1)
    .max(20)
    .optional()
    .describe(
      'Send to one or more predefined audience groups (1-20 group IDs). Each ID refers to ' +
        'an audience group already configured in PushEngage. Omit this field to send to all ' +
        'subscribers. Only set this when the user mentions a saved/predefined audience group.',
    ),
  android_push: AndroidPushSchema.optional().describe(
    'Android-specific options. Requires channel_id when set. Only when the user explicitly asks.',
  ),
  ios_push: IosPushSchema.optional().describe(
    'iOS-specific options. Only when the user explicitly asks.',
  ),
  send_in_subscribers_timezone: z
    .boolean()
    .optional()
    .describe(
      'Only valid when status="schedule" (and not combined with recurring_schedule). ' +
        "When true, schedule_date is interpreted in each subscriber's local timezone instead " +
        'of the site timezone — one delivery is scheduled per subscriber timezone so every ' +
        'recipient receives the push at the same wall-clock time. Only set this when the user ' +
        'explicitly asks for subscriber-timezone delivery (for example: "send at 9am in their timezone").',
    ),
  recurring_schedule: RecurringScheduleSchema.optional().describe(
    'OPTIONAL. Turns this into a recurring notification that fires on the chosen days/times ' +
      'between start_date and end_date. Mutually exclusive with status="schedule", ' +
      'schedule_date, and send_in_subscribers_timezone. With recurring_schedule set, leave ' +
      'status at "sent" (default) to activate the recurrence, or use "draft" to save without ' +
      'activating. Only set this when the user explicitly asks for a recurring/repeating notification.',
  ),
});

export const SendNotificationInputSchema = SendNotificationInputObject.superRefine((data, ctx) => {
  if (data.status === 'schedule' && !data.schedule_date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['schedule_date'],
      message: 'schedule_date is required when status is "schedule"',
    });
  }
  if (data.status !== 'schedule' && data.schedule_date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['schedule_date'],
      message: 'schedule_date is only valid when status is "schedule"',
    });
  }
  if (data.send_in_subscribers_timezone && data.status !== 'schedule') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['send_in_subscribers_timezone'],
      message: 'send_in_subscribers_timezone is only valid when status="schedule"',
    });
  }
  // recurring_schedule conflicts with the one-shot scheduling fields. The API's `source`
  // field is the single carrier for the delivery mode (repeat_scheduled vs. parent_sub_timezone
  // vs. plain API), so only one mode can win per request.
  if (data.recurring_schedule) {
    if (data.status === 'schedule') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status'],
        message:
          'status="schedule" is for one-shot scheduled sends. For a recurring notification, leave status at "sent" (or use "draft") and configure the recurrence in recurring_schedule.',
      });
    }
    if (data.schedule_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['schedule_date'],
        message: 'schedule_date cannot be combined with recurring_schedule.',
      });
    }
    if (data.send_in_subscribers_timezone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['send_in_subscribers_timezone'],
        message: 'send_in_subscribers_timezone cannot be combined with recurring_schedule.',
      });
    }
  }
});

export type SendNotificationInput = z.infer<typeof SendNotificationInputSchema>;

export type ApiNotificationBody = {
  notification_title: string;
  notification_message: string;
  notification_url: string;
  status: 'sent' | 'scheduled';
  // `source` is the single carrier for delivery mode:
  //   - 'API'                 default — send now or one-shot schedule
  //   - 'parent_sub_timezone' one-shot schedule, delivered at the scheduled wall-clock time
  //                           in each subscriber's local timezone
  //   - 'repeat_scheduled'    recurring notification driven by sche_options below; the API
  //                           flips the saved status to 'repeat_scheduled' internally on save.
  // superRefine on the input schema guarantees only one delivery mode applies per request.
  source: 'API' | 'parent_sub_timezone' | 'repeat_scheduled';
  valid_from?: string;
  notification_image?: string;
  big_image?: string;
  expiry?: number;
  tags?: string[];
  actions?: Array<{ label: string; url: string; image_url?: string }>;
  utm_params?: z.infer<typeof UtmParamsSchema>;
  notification_criteria?: Record<string, unknown>;
  android_push?: z.infer<typeof AndroidPushSchema>;
  ios_push?: z.infer<typeof IosPushSchema>;
  // Present only when source='repeat_scheduled'. Outer key is abbreviated (`sche_options`,
  // not `schedule_options`). Inner `schedule_time` is singular but holds an array.
  sche_options?: {
    schedule_days: string[];
    schedule_time: string[];
    schedule_start_date: string;
    schedule_end_date: string;
  };
};

export function toApiBody(input: SendNotificationInput): ApiNotificationBody {
  // API upsert contract:
  // - `action=draft` saves without sending; body.status must still be `sent` or `scheduled`.
  // - `action=sent` sends now, schedules when body.status is `scheduled`, or starts the
  //    recurrence when source='repeat_scheduled' (the API flips body.status to
  //    'repeat_scheduled' internally on save).
  const isRecurring = !!input.recurring_schedule;
  const apiStatus: ApiNotificationBody['status'] =
    !isRecurring && input.status === 'schedule' ? 'scheduled' : 'sent';

  // Resolve source. The three modes are mutually exclusive (superRefine enforces this).
  let apiSource: ApiNotificationBody['source'] = 'API';
  if (isRecurring) {
    apiSource = 'repeat_scheduled';
  } else if (input.send_in_subscribers_timezone && input.status === 'schedule') {
    apiSource = 'parent_sub_timezone';
  }

  const body: ApiNotificationBody = {
    notification_title: input.title,
    notification_message: input.message,
    notification_url: input.url,
    status: apiStatus,
    source: apiSource,
  };

  if (input.recurring_schedule) {
    body.sche_options = {
      schedule_days: [...input.recurring_schedule.days],
      schedule_time: input.recurring_schedule.times.map(normalizeTimeOfDay),
      schedule_start_date: input.recurring_schedule.start_date,
      schedule_end_date: input.recurring_schedule.end_date,
    };
  } else if (input.schedule_date) {
    body.valid_from = input.schedule_date;
  }

  if (input.image_url) body.notification_image = input.image_url;
  if (input.big_image_url) body.big_image = input.big_image_url;
  if (input.expire_in !== undefined) body.expiry = input.expire_in;
  if (input.tags) body.tags = input.tags;
  if (input.actions) body.actions = input.actions;
  if (input.utm_params) body.utm_params = input.utm_params;
  if (input.android_push) body.android_push = input.android_push;
  if (input.ios_push) body.ios_push = input.ios_push;

  // notification_criteria is a discriminated shape on the API side. We only expose
  // the audience-group mode here; custom segment/geo/device targeting is deliberately
  // not surfaced to the LLM. Omit notification_criteria entirely for "Send to All
  // Subscribers".
  if (input.audience_groups) {
    body.notification_criteria = { audience: { groups: input.audience_groups } };
  }

  return body;
}

// =============================================================================
// A/B notifications
// =============================================================================
//
// The same /sites/:siteId/notifications endpoint creates A/B notifications when
// called with `?type=ab`.
//
// Shape (API):
//   {
//     A: { notification_title, notification_message, notification_url, ... },
//     B: { notification_title, notification_message, notification_url, ... },
//     status: 'sent' | 'scheduled',
//     (source omitted — API defaults to Dashboard for A/B upserts)
//     valid_from?: ...,
//     notification_criteria?: ...,
//     tags?: ...,
//     execution_state?: {                                       // OPTIONAL — only when intelligent A/B is on
//       params:      { sent_limit },                            // required iff abc is present
//       abc:         { sent_limit_percentage, winner_delay },   // both required iff abc is present
//       result_name?: string,
//     },
//   }
//
// MCP-facing shape uses lowercase `variant_a` / `variant_b`. The dashboard's
// "Intelligent AB Test" toggle is modelled as an OPTIONAL `intelligent_ab_test`
// object. When omitted, the request creates a plain A/B notification (both
// variants ship as-is with no automatic winner picking) and `execution_state`
// is not sent on the API body. When provided, the three required fields enable
// the auto-winner roll-out.

const MAX_AB_SENT_LIMIT_PERCENTAGE = 99;
const MAX_AB_WINNER_DELAY_MINUTES = 10080; // 7 days, mirrors NOTIS_DB_SIZE.max.winnerDelay

const AbVariantSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).describe('Variant title'),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH).describe('Variant message body'),
  url: z.string().url().describe('Destination URL when the subscriber clicks the variant'),
  image_url: z
    .string()
    .url()
    .optional()
    .describe('Small icon for this variant. Only when the user explicitly asks.'),
  big_image_url: z
    .string()
    .url()
    .optional()
    .describe('Large hero image for this variant. Only when the user explicitly asks.'),
  expire_in: z
    .number()
    .int()
    .min(MIN_EXPIRE_IN_SECONDS)
    .max(MAX_EXPIRE_IN_SECONDS)
    .optional()
    .describe('Variant expiry in seconds (60–2419200).'),
  actions: z
    .array(ActionSchema)
    .min(1)
    .max(2)
    .optional()
    .describe('Action buttons for this variant.'),
  utm_params: UtmParamsSchema.optional().describe('UTM tracking params for this variant.'),
  android_push: AndroidPushSchema.optional().describe('Android-specific options for this variant.'),
  ios_push: IosPushSchema.optional().describe('iOS-specific options for this variant.'),
});

export type AbVariantInput = z.infer<typeof AbVariantSchema>;

// Same split rationale as SendNotificationInputObject above — the SDK introspects the
// plain ZodObject for the JSON Schema, and the handler re-parses through
// `SendAbNotificationInputSchema` to enforce the cross-field rules.
export const SendAbNotificationInputObject = z.object({
  variant_a: AbVariantSchema.describe('A/B variant A. Required.'),
  variant_b: AbVariantSchema.describe('A/B variant B. Required.'),
  status: z
    .enum(['sent', 'schedule', 'draft'])
    .default('sent')
    .describe(
      'Send now (sent), schedule for later (schedule), or save without sending (draft). The API only accepts sent and scheduled in the body; draft is conveyed via the action query param while the body still carries status="sent".',
    ),
  schedule_date: ApiDateTimeSchema.optional().describe(
    'Required when status is "schedule". Format: YYYY-MM-DD HH:mm:ss in the site timezone.',
  ),
  site_id: z.number().int().positive().optional().describe('Override the currently selected site'),
  audience_groups: z
    .array(z.number().int().positive())
    .min(1)
    .max(20)
    .optional()
    .describe(
      'Send to one or more predefined audience groups (1-20 group IDs). Applies to both ' +
        'variants. Omit to send to all subscribers. Only set when the user mentions a ' +
        'saved/predefined audience group.',
    ),
  tags: z
    .array(z.string().trim().min(1).max(MAX_TAG_LENGTH))
    .max(MAX_TAGS)
    .optional()
    .describe('Up to 5 tags, 36 chars each. Only when the user explicitly asks for tags.'),
  intelligent_ab_test: z
    .object({
      sent_limit: z
        .number()
        .int()
        .positive()
        .describe(
          'Total subscriber cap across the test and the winner roll-out. e.g. 10000 means up to 10000 subscribers will be touched in total.',
        ),
      sent_limit_percentage: z
        .number()
        .int()
        .min(1)
        .max(MAX_AB_SENT_LIMIT_PERCENTAGE)
        .describe(
          'Percentage of sent_limit allocated to each variant for the test phase. e.g. 10 means 10% to A, 10% to B, and the remaining 80% goes to the winner after winner_delay_minutes.',
        ),
      winner_delay_minutes: z
        .number()
        .int()
        .min(1)
        .max(MAX_AB_WINNER_DELAY_MINUTES)
        .describe(
          'How long to wait (in minutes, max 10080 = 7 days) before picking the winner (higher CTR) and rolling out to the remaining audience.',
        ),
      result_name: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('Optional human-readable label for the A/B test result row.'),
    })
    .optional()
    .describe(
      'OPTIONAL. Enables intelligent A/B testing: each variant is delivered to ' +
        'sent_limit_percentage% of subscribers, then after winner_delay_minutes the variant ' +
        'with the higher click-through rate is automatically sent to the remaining audience ' +
        '(up to sent_limit subscribers total). Omit this field to send a plain A/B where both ' +
        'variants ship as-is to the audience with no automatic winner selection. Only include ' +
        'when the user explicitly asks for an intelligent / auto-winner A/B test.',
    ),
});

export const SendAbNotificationInputSchema = SendAbNotificationInputObject.superRefine(
  (data, ctx) => {
    if (data.status === 'schedule' && !data.schedule_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['schedule_date'],
        message: 'schedule_date is required when status is "schedule"',
      });
    }
    if (data.status !== 'schedule' && data.schedule_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['schedule_date'],
        message: 'schedule_date is only valid when status is "schedule"',
      });
    }
  },
);

export type SendAbNotificationInput = z.infer<typeof SendAbNotificationInputSchema>;

type ApiAbVariantBody = {
  notification_title: string;
  notification_message: string;
  notification_url: string;
  notification_image?: string;
  big_image?: string;
  expiry?: number;
  actions?: Array<{ label: string; url: string; image_url?: string }>;
  utm_params?: z.infer<typeof UtmParamsSchema>;
  android_push?: z.infer<typeof AndroidPushSchema>;
  ios_push?: z.infer<typeof IosPushSchema>;
};

export type ApiAbNotificationBody = {
  A: ApiAbVariantBody;
  B: ApiAbVariantBody;
  status: 'sent' | 'scheduled';
  valid_from?: string;
  notification_criteria?: Record<string, unknown>;
  tags?: string[];
  // Only present when the caller opted into the intelligent A/B test mode.
  execution_state?: {
    params: { sent_limit: number };
    abc: { sent_limit_percentage: number; winner_delay: number };
    result_name?: string;
  };
};

function variantToApiBody(v: AbVariantInput): ApiAbVariantBody {
  const out: ApiAbVariantBody = {
    notification_title: v.title,
    notification_message: v.message,
    notification_url: v.url,
  };
  if (v.image_url) out.notification_image = v.image_url;
  if (v.big_image_url) out.big_image = v.big_image_url;
  if (v.expire_in !== undefined) out.expiry = v.expire_in;
  if (v.actions) out.actions = v.actions;
  if (v.utm_params) out.utm_params = v.utm_params;
  if (v.android_push) out.android_push = v.android_push;
  if (v.ios_push) out.ios_push = v.ios_push;
  return out;
}

export function toAbApiBody(input: SendAbNotificationInput): ApiAbNotificationBody {
  const apiStatus: ApiAbNotificationBody['status'] =
    input.status === 'schedule' ? 'scheduled' : 'sent';

  const body: ApiAbNotificationBody = {
    A: variantToApiBody(input.variant_a),
    B: variantToApiBody(input.variant_b),
    status: apiStatus,
  };

  // execution_state only appears when the caller opted into intelligent A/B.
  // The Adonis validator strips params.sent_limit unless `abc` is present, so it's
  // safe to send execution_state only in this branch.
  if (input.intelligent_ab_test) {
    const t = input.intelligent_ab_test;
    body.execution_state = {
      params: { sent_limit: t.sent_limit },
      abc: {
        sent_limit_percentage: t.sent_limit_percentage,
        // MCP-facing name carries the unit (`_minutes`); API field is just `winner_delay`.
        winner_delay: t.winner_delay_minutes,
      },
    };
    if (t.result_name) {
      body.execution_state.result_name = t.result_name;
    }
  }

  if (input.schedule_date) body.valid_from = input.schedule_date;
  if (input.tags) body.tags = input.tags;
  if (input.audience_groups) {
    body.notification_criteria = { audience: { groups: input.audience_groups } };
  }

  return body;
}

// ---- pushengage_list_notifications ---------------------------------------------------

const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 100;
/** The API rejects sent-date filters earlier than this (NOTIS_DB_SIZE.min.sentDate). */
const MIN_SENT_DATE = '2017-07-01';

/**
 * Status filter values mirror the dashboard's tabs, and — like the dashboard — each value
 * expands server-side to a family of raw statuses: "sent" also matches currently-sending,
 * "scheduled" also matches recurring (repeat_scheduled) and paused recurrences, and "draft"
 * also matches archived. "all" omits the filter (everything except deleted/in-flight rows).
 */
const LIST_STATUS_VALUES = ['all', 'sent', 'scheduled', 'draft'] as const;

// Same plain-object/superRefine split as SendNotificationInputObject above — the SDK
// introspects a plain ZodObject; the cross-field sent_after/sent_before rules live in
// ListNotificationsInputSchema, re-parsed in the tool handler.
export const ListNotificationsInputObject = z.object({
  site_id: z.number().int().positive().optional().describe('Override the currently selected site'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_LIMIT)
    .default(DEFAULT_LIST_LIMIT)
    .describe(
      `How many notifications to return in this page. Min 1, max ${MAX_LIST_LIMIT}, default ${DEFAULT_LIST_LIMIT}. ` +
        `To browse past the first ${MAX_LIST_LIMIT}, increase \`page\` instead of asking for a larger limit.`,
    ),
  page: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe('Page number (1-indexed) for paginating beyond the first batch.'),
  status: z
    .enum(LIST_STATUS_VALUES)
    .default('all')
    .describe(
      'Filter by status, matching the dashboard tabs: "sent" (includes currently sending), ' +
        '"scheduled" (includes active and paused recurring notifications), "draft" (includes ' +
        'archived). "all" (default) returns every status.',
    ),
  sent_after: z
    .string()
    .regex(CALENDAR_DATE_REGEX, 'Must be YYYY-MM-DD')
    .optional()
    .describe(
      'Only notifications sent on or after this date (YYYY-MM-DD, site timezone). ' +
        `Must be ${MIN_SENT_DATE} or later, and must be paired with sent_before.`,
    ),
  sent_before: z
    .string()
    .regex(CALENDAR_DATE_REGEX, 'Must be YYYY-MM-DD')
    .optional()
    .describe(
      'Only notifications sent on or before this date (YYYY-MM-DD, site timezone). ' +
        'Must be paired with sent_after and be on or after it.',
    ),
  tags: z
    .array(z.string().trim().min(1).max(MAX_TAG_LENGTH))
    .min(1)
    .max(MAX_TAGS)
    .optional()
    .describe('Only notifications carrying at least one of these tags (up to 5).'),
  exclude_tags: z
    .array(z.string().trim().min(1).max(MAX_TAG_LENGTH))
    .min(1)
    .max(MAX_TAGS)
    .optional()
    .describe('Exclude notifications carrying any of these tags (up to 5).'),
  include_analytics: z
    .boolean()
    .default(false)
    .describe(
      'When true, merge in full delivery analytics (A/B variant totals and subscriber-timezone ' +
        'child sends roll up into the parent row) and goal conversions (goal_count/goal_value ' +
        'per row). Costs extra lookups; only set it when the user asks for stats/performance.',
    ),
});

export const ListNotificationsInputSchema = ListNotificationsInputObject.superRefine(
  (data, ctx) => {
    // The API requires the sent-date bounds as a pair: end_sent_at is mandatory once
    // start_sent_at is present, and rejected without it.
    if (data.sent_after && !data.sent_before) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sent_before'],
        message: 'sent_before is required when sent_after is set (the API needs both bounds).',
      });
    }
    if (data.sent_before && !data.sent_after) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sent_after'],
        message: 'sent_after is required when sent_before is set (the API needs both bounds).',
      });
    }
    if (data.sent_after && data.sent_before && data.sent_before < data.sent_after) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sent_before'],
        message: 'sent_before must be on or after sent_after.',
      });
    }
    if (data.sent_after && data.sent_after < MIN_SENT_DATE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sent_after'],
        message: `sent_after must be ${MIN_SENT_DATE} or later.`,
      });
    }
  },
);

export type ListNotificationsInput = z.infer<typeof ListNotificationsInputSchema>;

/**
 * Query params for GET /sites/:siteId/notifications. MCP-facing names translate at this
 * boundary: sent_after/sent_before → start_sent_at/end_sent_at, exclude_tags → tags_exclude,
 * include_analytics → expand=notification_analytics. Tag filters are comma-joined because the
 * API parses them with its stringArray (comma-separated) convention.
 */
export type ApiListNotificationsQuery = {
  limit: number;
  page: number;
  status?: 'sent' | 'scheduled' | 'draft';
  start_sent_at?: string;
  end_sent_at?: string;
  tags?: string;
  tags_exclude?: string;
  expand?: string;
};

export function toListNotificationsQuery(input: ListNotificationsInput): ApiListNotificationsQuery {
  const query: ApiListNotificationsQuery = {
    limit: input.limit,
    page: input.page,
  };
  if (input.status !== 'all') query.status = input.status;
  if (input.sent_after) query.start_sent_at = input.sent_after;
  if (input.sent_before) query.end_sent_at = input.sent_before;
  if (input.tags) query.tags = input.tags.join(',');
  if (input.exclude_tags) query.tags_exclude = input.exclude_tags.join(',');
  // result_analytics is what populates each row's goal (`result`) map; notification_analytics
  // rolls A/B variant and subscriber-timezone child counts into the parent row.
  if (input.include_analytics) query.expand = 'notification_analytics,result_analytics';
  return query;
}
