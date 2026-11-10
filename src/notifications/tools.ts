// src/notifications/tools.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { errorResult } from '../http/errors';
import { resolveContext } from '../context';
import { notificationUrl } from '../dashboardUrl';
import { convertToSiteWallClock } from '../datetime/timezone';
import type { ScheduleConversion } from '../datetime/timezone';
import { ValidationError } from '../http/errors';
import { getSiteDetails } from '../sites/api';
import { resolveSubscriberFilter } from '../subscriberFilter/resolve';
import {
  NotificationsListOutput,
  SendAbNotificationOutput,
  SendNotificationOutput,
} from '../output';
import { createAbNotification, createNotification, listNotifications } from './api';
import {
  ListNotificationsInputObject,
  ListNotificationsInputSchema,
  SendAbNotificationInputObject,
  SendAbNotificationInputSchema,
  SendNotificationInputObject,
  SendNotificationInputSchema,
  toAbApiBody,
  toApiBody,
  toListNotificationsQuery,
} from './schema';

/**
 * Reinterpret `schedule_date` from the caller's timezone into the site's.
 *
 * The API reads a bare `schedule_date` as the SITE's local time
 * (`moment.localToUtc(scheduleDate, timezone)`), so when the caller is working in a different
 * zone the request has to carry the site's wall clock instead of theirs. Costs one extra GET,
 * and only when `schedule_timezone` is set.
 *
 * The site's timezone may be either a legacy fixed-offset code (`UP55`) or an IANA name
 * (`Asia/Kolkata`); `convertToSiteWallClock` handles both the way the API does. Prod is almost
 * entirely IANA.
 *
 * Fails rather than guessing when it is neither: the API falls back to +00:00 for an unrecognised
 * value, which is how you schedule a send hours away from what anyone intended.
 */
async function resolveScheduleTimezone(
  client: Parameters<typeof getSiteDetails>[0],
  siteId: number,
  scheduleDate: string,
  scheduleTimezone: string,
): Promise<ScheduleConversion> {
  const details = await getSiteDetails(client, siteId);
  const siteTimezone = details.timezone;
  if (!siteTimezone) {
    throw new ValidationError(
      "Could not read this site's timezone, so the schedule time could not be converted and " +
        'nothing was sent. Retry without schedule_timezone and give schedule_date in the ' +
        "site's own local time.",
      { schedule_timezone: 'site timezone unavailable' },
    );
  }
  const conversion = convertToSiteWallClock(scheduleDate, scheduleTimezone, siteTimezone);
  if (!conversion) {
    throw new ValidationError(
      `This site's timezone ("${siteTimezone}") is neither a recognised IANA zone nor a known ` +
        `PushEngage timezone code, so ${scheduleDate} could not be converted from ` +
        `${scheduleTimezone} and nothing was sent. Retry without schedule_timezone, giving ` +
        "schedule_date in the site's own local time.",
      { schedule_timezone: `unrecognised site timezone ${siteTimezone}` },
    );
  }
  return conversion;
}

export function registerNotificationTools(server: McpServer): void {
  server.registerTool(
    'pushengage_list_notifications',
    {
      title: 'List notifications',
      description:
        'Lists push notifications on the current site, newest first, paginated (response includes ' +
        '`has_more`). Use this to discover notification IDs and review past or upcoming sends. ' +
        'Set include_analytics=true only when the user asks for stats — it costs an extra lookup ' +
        'and adds rolled-up counts and goal conversions to each row. ' +
        'Each item carries content, status, targeting criteria, and delivery stats; the ' +
        "criteria.audience_groups ids are reusable as the send tools' audience_groups input, and " +
        'absent criteria means the notification went to all subscribers.',
      // Same plain-object trick as pushengage_send_notification below — the SDK introspects a
      // plain ZodObject; the sent_after/sent_before pairing rules are re-parsed in the handler.
      inputSchema: ListNotificationsInputObject,
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: NotificationsListOutput,
    },
    async (rawInput) => {
      try {
        const input = ListNotificationsInputSchema.parse(rawInput);
        const { client, siteId } = await resolveContext(input.site_id);
        const result = await listNotifications(client, siteId, toListNotificationsQuery(input));
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'pushengage_send_notification',
    {
      title: 'Send a push notification',
      description:
        'Creates and sends a push notification on the current site. Required fields: title, message, url. ' +
        'Do not add optional fields (tags, image_url, utm_params, audience_groups, actions, etc.) unless the user explicitly asks for them — ' +
        'for example, do not infer tags from the notification topic. ' +
        'Delivery modes (mutually exclusive — pick AT MOST one): ' +
        '(a) status="schedule" + schedule_date for a one-shot scheduled send; ' +
        '(b) pass recurring_schedule { days, times, start_date, end_date } for a recurring/repeating notification — leave status at "sent" (default) to activate the recurrence, or use "draft" to save without activating; ' +
        '(c) when scheduling one-shot, optionally pass send_in_subscribers_timezone=true to deliver at the scheduled wall-clock time in each subscriber\'s local timezone (only when the user explicitly asks, e.g. "send at 9am in their timezone"). ' +
        'Otherwise the notification is sent immediately. ' +
        'Use status="draft" to save without sending or activating. ' +
        'Audience — the three options the dashboard offers, pick AT MOST one (they are mutually exclusive): ' +
        'omit both fields for "Send to All Subscribers"; pass `audience_groups` (1-20 predefined audience-group IDs) ' +
        'for "Send to Audience Group" when the user names a saved group; or pass `subscriber_filter` for ' +
        '"Send to Custom Audience" — targeting by segment, attribute, location, device, browser, subscription or ' +
        'engagement date, or sent/view/click counts. ' +
        'Segment names in subscriber_filter are resolved automatically, so "send to my Sports Fans segment" needs no lookup — ' +
        'but call pushengage_list_audience_filter_values first for any country/state/city/device/device_type value, and ' +
        'pushengage_list_attributes first for any attribute `key`, because those are site-specific and a guessed ' +
        'value produces a notification that saves successfully and reaches the wrong people. ' +
        "When the user asks to use the site URL, call pushengage_list_sites and use the current site's site_url.",
      // Register the plain object — the SDK introspects this to build the JSON Schema the
      // LLM sees. We re-parse rawInput through SendNotificationInputSchema below to enforce
      // the cross-field rules (schedule_date / recurring_schedule mutual exclusion, etc.).
      inputSchema: SendNotificationInputObject,
      // Not read-only and not idempotent: each call dispatches a real push to subscribers.
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      outputSchema: SendNotificationOutput,
    },
    async (rawInput) => {
      try {
        const input = SendNotificationInputSchema.parse(rawInput);
        const { client, siteId, config } = await resolveContext(input.site_id);
        // Convert the caller's wall clock into the site's before anything else, so a failed
        // conversion costs nothing.
        //
        // Never when `send_in_subscribers_timezone` is set: there the API stores schedule_date
        // verbatim as the per-subscriber wall clock, so converting it would move every
        // recipient's delivery. The schema rejects that combination outright — this is the second
        // guard, for any caller that builds the input without it.
        const scheduleConversion =
          input.schedule_timezone && input.schedule_date && !input.send_in_subscribers_timezone
            ? await resolveScheduleTimezone(
                client,
                siteId,
                input.schedule_date,
                input.schedule_timezone,
              )
            : undefined;
        const scheduledInput = scheduleConversion
          ? { ...input, schedule_date: scheduleConversion.send_as }
          : input;
        // Resolve BEFORE building the body: segment names become ids, and every segment and
        // attribute reference is checked against the site. An unresolvable one throws here, so
        // nothing is dispatched — see resolveSubscriberFilter for why that matters more than it
        // looks (an unknown segment silently widens the send to every subscriber).
        const filterResult = scheduledInput.subscriber_filter
          ? await resolveSubscriberFilter(client, siteId, scheduledInput.subscriber_filter)
          : undefined;
        const resolvedInput = filterResult
          ? { ...scheduledInput, subscriber_filter: filterResult.filter }
          : scheduledInput;
        const body = toApiBody(resolvedInput);
        const created = await createNotification(client, siteId, resolvedInput, body);
        const viewUrl = notificationUrl(config.dashboard_url, created.notification_id);
        const responsePayload: Record<string, unknown> = {
          notification_id: created.notification_id,
          // For recurring sends, the API flips this to 'repeat_scheduled' on save.
          status: created.status,
          title: created.notification_title ?? body.notification_title,
          message: created.notification_message ?? body.notification_message,
          url: created.notification_url ?? body.notification_url,
          view_url: viewUrl,
        };
        // Report any filter date values that were reinterpreted, so the assistant can tell the
        // user which dates moved and to what.
        if (filterResult && filterResult.date_conversions.length > 0) {
          responsePayload.filter_date_conversions = filterResult.date_conversions;
        }
        if (body.sche_options) {
          responsePayload.recurring_schedule = {
            days: body.sche_options.schedule_days,
            times: body.sche_options.schedule_time,
            start_date: body.sche_options.schedule_start_date,
            end_date: body.sche_options.schedule_end_date,
          };
        } else {
          responsePayload.scheduled_for = created.valid_from;
          responsePayload.scheduled_in_subscribers_timezone = body.source === 'parent_sub_timezone';
          // Surface the conversion so the assistant can state plainly what was scheduled —
          // the caller asked in their own timezone and the stored time is the site's.
          if (scheduleConversion) responsePayload.schedule_conversion = scheduleConversion;
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(responsePayload, null, 2) }],
          structuredContent: responsePayload,
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'pushengage_send_ab_notification',
    {
      title: 'Send an A/B push notification',
      description:
        'Creates an A/B notification on the current site with two variants (variant_a and variant_b). ' +
        'Required: variant_a (title, message, url) and variant_b (title, message, url). ' +
        'By default (intelligent_ab_test omitted) both variants ship as-is to the audience — no automatic winner picking. ' +
        'Pass intelligent_ab_test to enable intelligent / auto-winner mode: each variant is sent to sent_limit_percentage% of subscribers, ' +
        'and after winner_delay_minutes the higher-CTR variant is automatically delivered to the remaining audience (up to sent_limit total). ' +
        'Only include intelligent_ab_test when the user explicitly asks for an intelligent / auto-winner test. ' +
        'Do not add other optional fields (tags, audience_groups, per-variant image_url, utm_params, actions, etc.) unless the user explicitly asks. ' +
        'Audience (pick AT MOST one — mutually exclusive; omit both to send to all subscribers): `audience_groups` ' +
        '(1-20 predefined audience-group IDs), or `subscriber_filter` for "Send to Custom Audience". Both apply to both ' +
        'variants, and subscriber_filter behaves exactly as it does on pushengage_send_notification. ' +
        'Use status="schedule" with schedule_date to schedule for later, or status="draft" to save without sending.',
      // Same plain-object trick as pushengage_send_notification above — SDK needs a plain ZodObject.
      inputSchema: SendAbNotificationInputObject,
      // Not read-only and not idempotent: each call dispatches a real A/B push to subscribers.
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      outputSchema: SendAbNotificationOutput,
    },
    async (rawInput) => {
      try {
        const input = SendAbNotificationInputSchema.parse(rawInput);
        const { client, siteId, config } = await resolveContext(input.site_id);
        const scheduleConversion =
          input.schedule_timezone && input.schedule_date
            ? await resolveScheduleTimezone(
                client,
                siteId,
                input.schedule_date,
                input.schedule_timezone,
              )
            : undefined;
        const scheduledInput = scheduleConversion
          ? { ...input, schedule_date: scheduleConversion.send_as }
          : input;
        // Same pre-dispatch resolution as the generic send above.
        const filterResult = scheduledInput.subscriber_filter
          ? await resolveSubscriberFilter(client, siteId, scheduledInput.subscriber_filter)
          : undefined;
        const resolvedInput = filterResult
          ? { ...scheduledInput, subscriber_filter: filterResult.filter }
          : scheduledInput;
        const body = toAbApiBody(resolvedInput);
        const created = await createAbNotification(client, siteId, resolvedInput, body);
        // Link by notification_id, NEVER by ab_notification_id. The dashboard's own list routes
        // every row — A/B rows included — through `notification.notification_id`
        // (pushengage-app/src/components/campaigns/PushBroadcastTable.tsx:188), and nothing in the
        // app navigates by the pair id, so a link built from it opens "notification not found".
        // QA N1 on PR #287; the earlier comment here had this backwards.
        const viewUrl = notificationUrl(config.dashboard_url, created.notification_id);
        const responsePayload: Record<string, unknown> = {
          notification_id: created.notification_id,
          ab_notification_id: created.ab_notification_id,
          status: created.status,
          scheduled_for: created.valid_from,
          variant_a: {
            title: body.A.notification_title,
            message: body.A.notification_message,
            url: body.A.notification_url,
          },
          variant_b: {
            title: body.B.notification_title,
            message: body.B.notification_message,
            url: body.B.notification_url,
          },
          intelligent_ab_test_enabled: !!body.execution_state,
          ...(scheduleConversion ? { schedule_conversion: scheduleConversion } : {}),
          ...(filterResult && filterResult.date_conversions.length > 0
            ? { filter_date_conversions: filterResult.date_conversions }
            : {}),
          view_url: viewUrl,
        };
        if (body.execution_state) {
          responsePayload.intelligent_ab_test = {
            sent_limit: body.execution_state.params.sent_limit,
            sent_limit_percentage: body.execution_state.abc.sent_limit_percentage,
            winner_delay_minutes: body.execution_state.abc.winner_delay,
            result_name: body.execution_state.result_name,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(responsePayload, null, 2) }],
          structuredContent: responsePayload,
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
