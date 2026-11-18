// src/notifications/tools.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { errorResult } from '../http/errors';
import { resolveContext } from '../context';
import { notificationUrl } from '../dashboardUrl';
import { convertToSiteWallClock, siteLocalDate } from '../datetime/timezone';
import type { ScheduleConversion } from '../datetime/timezone';
import { ValidationError } from '../http/errors';
import { getSiteDetails } from '../sites/api';
import { resolveSubscriberFilter } from '../subscriberFilter/resolve';
import {
  DeleteNotificationOutput,
  NotificationsListOutput,
  ResendNotificationOutput,
  SendAbNotificationOutput,
  SendNotificationOutput,
} from '../output';
import {
  createAbNotification,
  createNotification,
  deleteNotification,
  getNotification,
  listNotifications,
  resendNotification,
  updateNotification,
} from './api';
import {
  applyReplayedFields,
  describeSavedAudience,
  dropConflictingSchedule,
  flattenAbRead,
  notificationToSendInput,
  recurringStartDateIssue,
  whyNotDeletable,
  whyNotEditable,
  whyNotResendable,
} from './fromApi';
import {
  ListNotificationsInputObject,
  ListNotificationsInputSchema,
  SendAbNotificationInputObject,
  SendAbNotificationInputSchema,
  DeleteNotificationInputObject,
  DeleteNotificationInputSchema,
  DuplicateNotificationInputObject,
  DuplicateNotificationInputSchema,
  ResendNotificationInputObject,
  ResendNotificationInputSchema,
  SendNotificationInputObject,
  SendNotificationInputSchema,
  UpdateNotificationInputObject,
  UpdateNotificationInputSchema,
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

/**
 * Today's date in the site's own timezone, or null when it cannot be read.
 *
 * Never throws: this only decides which of two error messages a doomed edit gets, so a failed or
 * unreadable site lookup falls back to the lenient answer rather than failing the edit.
 */
async function siteTodayOrNull(
  client: Parameters<typeof getSiteDetails>[0],
  siteId: number,
): Promise<string | null> {
  try {
    const details = await getSiteDetails(client, siteId);
    return details.timezone ? siteLocalDate(details.timezone, Date.now()) : null;
  } catch {
    return null;
  }
}

/** `YYYY-MM-DD`, `days` away from the given date. */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Whether replaying this notification's recurrence unchanged would be rejected for its start date,
 * and what to say instead. See `recurringStartDateIssue` for why.
 *
 * The comparison needs the SITE's calendar date, which costs a GET — so it is only fetched for a
 * start date close enough to today for the two calendars to disagree. Timezone offsets run from
 * -12:00 to +14:00, so the site's date is always the UTC date or one day either side of it;
 * anything outside that window is unambiguous and answered without a call. When the site's
 * timezone cannot be read, the old lenient comparison (a day of slack) stands in, so this can
 * never refuse an edit the API would have accepted — it just loses the clearer message.
 */
async function recurringReplayIssue(
  client: Parameters<typeof getSiteDetails>[0],
  siteId: number,
  startDate: string | undefined,
  callerSetRecurrence: boolean,
): Promise<string | null> {
  if (callerSetRecurrence || startDate === undefined) return null;
  const utcToday = new Date().toISOString().slice(0, 10);
  if (startDate >= shiftDate(utcToday, 1)) return null;
  const today =
    startDate >= shiftDate(utcToday, -1)
      ? ((await siteTodayOrNull(client, siteId)) ?? shiftDate(utcToday, -1))
      : utcToday;
  return recurringStartDateIssue(startDate, false, today);
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

  server.registerTool(
    'pushengage_update_notification',
    {
      title: 'Edit a notification',
      description:
        'Edits an existing draft, scheduled or recurring notification. Pass notification_id plus ' +
        'ONLY the fields to change — everything else is carried over from the notification as it ' +
        'stands. ' +
        'Use this instead of pushengage_send_notification when the user wants to fix or adjust ' +
        'something already created ("change the title", "move it to 9am", "target a different ' +
        'segment"); use pushengage_send_notification to create something new. ' +
        'Cannot edit a notification that has already been sent or is sending, an RSS auto-push ' +
        'notification, or any part of an A/B test (editing one through the API breaks the test, ' +
        'so it is refused). Nor a notification belonging to a drip or triggered campaign, or one ' +
        "timezone's copy of a subscriber-timezone broadcast — manage those from the campaign or " +
        'the parent. ' +
        'Editing a PAUSED recurring notification resumes it — the API sets the status back to ' +
        'running on save, exactly as the dashboard does — so tell the user that before editing one. ' +
        'Changing the audience replaces it entirely: pass audience_groups or subscriber_filter to ' +
        'set a new one. A notification with no audience goes to all subscribers — the dashboard ' +
        'calls that "All Subscribers" — and editing one is allowed; the response reports the ' +
        'audience that was saved either way, and names any audience group the API dropped ' +
        'because it no longer exists — the send then reaches all subscribers, so tell the user. ' +
        'Do not add optional fields unless the user explicitly asks to change them.',
      inputSchema: UpdateNotificationInputObject.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      outputSchema: SendNotificationOutput,
    },
    async (rawInput) => {
      try {
        const input = UpdateNotificationInputSchema.parse(rawInput);
        const { client, siteId, config } = await resolveContext(input.site_id);

        // Read first: the update is a full replace, so the current state IS the payload for
        // everything the caller did not mention. See fromApi.ts for why a partial body is unsafe.
        // An A/B parent reads back as `{ ab, A, B }` rather than a flat notification, so flatten
        // it before anything inspects `source` or `status` (review of PR #290).
        const current = flattenAbRead(await getNotification(client, siteId, input.notification_id));
        if (Object.keys(current).length === 0) {
          throw new ValidationError(
            `Notification ${input.notification_id} was not found on this site, so nothing was changed.`,
            { notification_id: 'not found' },
          );
        }

        const refusal = whyNotEditable(current);
        if (refusal) throw new ValidationError(`${refusal} Nothing was changed.`);

        const { notification_id: _id, site_id: _siteId, ...overrides } = input;
        // Replay the notification, then drop whatever the caller's own changes have made
        // contradictory — changing the status alone would otherwise collide with the scheduling
        // fields that were replayed with it.
        const base = dropConflictingSchedule(notificationToSendInput(current), overrides);

        // A running recurrence cannot be replayed as-is: the API insists its start date is still
        // in the future, so an edit that only changes a title would be rejected for a reason the
        // caller never touched. Say so here instead.
        const recurringIssue = await recurringReplayIssue(
          client,
          siteId,
          base.recurring_schedule?.start_date,
          overrides.recurring_schedule !== undefined,
        );
        if (recurringIssue) throw new ValidationError(`${recurringIssue} Nothing was changed.`);
        // The caller's fields win; everything else is replayed as-is. Re-parsing through the
        // create schema applies every cross-field rule the send path already enforces, so the
        // two can never drift.
        const merged = SendNotificationInputSchema.parse({ ...base, ...overrides });

        const scheduleConversion =
          merged.schedule_timezone && merged.schedule_date && !merged.send_in_subscribers_timezone
            ? await resolveScheduleTimezone(
                client,
                siteId,
                merged.schedule_date,
                merged.schedule_timezone,
              )
            : undefined;
        const scheduledInput = scheduleConversion
          ? { ...merged, schedule_date: scheduleConversion.send_as }
          : merged;

        // Re-resolved on every edit, not just when the caller changes the audience: a segment
        // this notification already targets may have been renamed or deactivated since, and
        // posting a reference the API then drops would widen the send to everyone.
        const filterResult = scheduledInput.subscriber_filter
          ? await resolveSubscriberFilter(
              client,
              siteId,
              scheduledInput.subscriber_filter,
              'changed',
            )
          : undefined;
        const resolvedInput = filterResult
          ? { ...scheduledInput, subscriber_filter: filterResult.filter }
          : scheduledInput;

        // Replayed, not input: these are stripped by the parse above and must be re-applied.
        const body = applyReplayedFields(toApiBody(resolvedInput), base);
        const updated = await updateNotification(
          client,
          siteId,
          input.notification_id,
          resolvedInput,
          body,
        );

        const savedAudience = describeSavedAudience(
          updated.notification_criteria,
          resolvedInput.audience_groups,
        );
        const responsePayload: Record<string, unknown> = {
          notification_id: updated.notification_id ?? input.notification_id,
          status: updated.status ?? body.status,
          title: updated.notification_title ?? body.notification_title,
          message: updated.notification_message ?? body.notification_message,
          url: updated.notification_url ?? body.notification_url,
          view_url: notificationUrl(config.dashboard_url, input.notification_id),
          // What the caller actually asked to change, so the assistant can report it back
          // precisely rather than implying the whole notification was rewritten.
          updated_fields: Object.keys(overrides),
          // Stated on every edit, and read back from the API's own answer rather than from the
          // request: an audience group that no longer exists is dropped server-side and the send
          // widens to everyone. See `describeSavedAudience`.
          audience: savedAudience.audience,
        };
        if (savedAudience.dropped_audience_groups) {
          responsePayload.dropped_audience_groups = savedAudience.dropped_audience_groups;
        }
        // The API resumes a paused recurrence on save. The tool description warns the assistant
        // beforehand; this says it happened, so the confirmation back to the user does not have to
        // rely on the assistant having remembered (QA F3 on PR #290).
        if (current.status === 'pause_repeat_scheduled') {
          responsePayload.resumed_from_paused = true;
        }
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
          responsePayload.scheduled_for = updated.valid_from ?? body.valid_from;
          responsePayload.scheduled_in_subscribers_timezone = body.source === 'parent_sub_timezone';
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
    'pushengage_delete_notification',
    {
      title: 'Delete a notification',
      description:
        'Deletes a draft, scheduled or recurring notification, cancelling it if it had not gone ' +
        'out yet. ' +
        'A notification that has already been sent CANNOT be deleted — its delivery record is ' +
        'kept — and neither can an RSS auto-push notification. Deleting the PARENT of an A/B test ' +
        'removes the whole test including its other variant; a single variant cannot be deleted on ' +
        'its own, and neither can a drip, triggered or single-timezone notification. For a ' +
        'subscriber-timezone send this also removes the per timezone notifications that have not ' +
        'been delivered. ' +
        'This cancels a pending send, so confirm with the user before calling it.',
      inputSchema: DeleteNotificationInputObject.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      outputSchema: DeleteNotificationOutput,
    },
    async (rawInput) => {
      try {
        const input = DeleteNotificationInputSchema.parse(rawInput);
        const { client, siteId } = await resolveContext(input.site_id);

        // Read first so the refusal can name the actual reason. The API would reject an
        // undeletable notification anyway, but with a generic message.
        // An A/B parent reads back as `{ ab, A, B }` rather than a flat notification, so flatten
        // it before anything inspects `source` or `status` (review of PR #290).
        const current = flattenAbRead(await getNotification(client, siteId, input.notification_id));
        if (Object.keys(current).length === 0) {
          throw new ValidationError(
            `Notification ${input.notification_id} was not found on this site, so nothing was deleted.`,
            { notification_id: 'not found' },
          );
        }
        const refusal = whyNotDeletable(current);
        if (refusal) throw new ValidationError(`${refusal} Nothing was deleted.`);

        const result = await deleteNotification(client, siteId, input.notification_id);
        const responsePayload = {
          notification_id: input.notification_id,
          deleted: true,
          deleted_count: result.count ?? 1,
          title: current.notification_title ?? undefined,
        };
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
    'pushengage_resend_notification',
    {
      title: 'Resend a sent notification',
      description:
        'Sends an already-sent notification again, exactly as stored — the content cannot be ' +
        'changed on the way out, because the API re-reads the notification itself. ' +
        'Resending creates a NEW notification: the response reports its id, with the original ' +
        'as `resent_from`. ' +
        'Only works on a notification that has already been sent. To send a draft or a scheduled ' +
        'one now, use pushengage_update_notification with status="sent"; to send a changed copy, ' +
        'use pushengage_duplicate_notification. Subscriber-timezone sends cannot be resent, nor ' +
        'can a single A/B variant or a drip or triggered campaign notification. ' +
        "Each call dispatches a real push to the notification's original audience, so confirm " +
        'with the user before calling it.',
      inputSchema: ResendNotificationInputObject.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      outputSchema: ResendNotificationOutput,
    },
    async (rawInput) => {
      try {
        const input = ResendNotificationInputSchema.parse(rawInput);
        const { client, siteId, config } = await resolveContext(input.site_id);

        // An A/B parent reads back as `{ ab, A, B }` rather than a flat notification, so flatten
        // it before anything inspects `source` or `status` (review of PR #290).
        const current = flattenAbRead(await getNotification(client, siteId, input.notification_id));
        if (Object.keys(current).length === 0) {
          throw new ValidationError(
            `Notification ${input.notification_id} was not found on this site, so nothing was sent.`,
            { notification_id: 'not found' },
          );
        }
        const refusal = whyNotResendable(current);
        if (refusal) throw new ValidationError(`${refusal} Nothing was sent.`);

        const result = await resendNotification(client, siteId, input.notification_id);
        // Resending creates a NEW notification, and the id of that one is what the caller needs —
        // it is the row the dashboard link opens and the one any follow-up acts on. An A/B resend
        // answers `{ ab, A, B }` like an A/B read, so the new id sits under `A`, not at the top
        // level; without flattening, the response named the ORIGINAL notification while silently
        // having sent a different one (QA F4 on PR #290).
        const resent = flattenAbRead(result);
        const newId =
          typeof resent.notification_id === 'number' ? resent.notification_id : undefined;
        const responsePayload: Record<string, unknown> = {
          notification_id: newId ?? input.notification_id,
          resent: true,
          resent_from: input.notification_id,
          title: current.notification_title ?? undefined,
          view_url: notificationUrl(config.dashboard_url, newId ?? input.notification_id),
        };
        if (typeof resent.ab_notification_id === 'number') {
          responsePayload.ab_notification_id = resent.ab_notification_id;
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
    'pushengage_duplicate_notification',
    {
      title: 'Duplicate a notification',
      description:
        'Creates a NEW notification from an existing one, reusing its content, image, audience ' +
        'and UTM parameters. Pass any field to change it in the copy. ' +
        'Works from a notification in any state, including one already sent or deleted — nothing ' +
        'about the original is modified, so copying a deleted one recovers its content. ' +
        'This is the way to "send that again but with a different title", ' +
        'where pushengage_resend_notification would send the original unchanged. ' +
        'The copy is saved as a DRAFT unless you pass status="sent" (dispatches immediately) or ' +
        'status="schedule" with a schedule_date. ' +
        "This differs from the dashboard's Duplicate button on purpose: the dashboard carries over " +
        "the original's schedule, recurrence, subscriber-timezone setting and A/B shape, while " +
        "this copies the CONTENT and audience only and leaves the timing to you — the original's " +
        'date is in the past for anything already sent. Copying an A/B test therefore produces a ' +
        'plain notification from its A variant, not another test. ' +
        'Do not add optional fields unless the user explicitly asks to change them.',
      inputSchema: DuplicateNotificationInputObject.shape,
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
        const input = DuplicateNotificationInputSchema.parse(rawInput);
        const { client, siteId, config } = await resolveContext(input.site_id);

        const source = flattenAbRead(await getNotification(client, siteId, input.notification_id));
        if (Object.keys(source).length === 0) {
          throw new ValidationError(
            `Notification ${input.notification_id} was not found on this site, so nothing was created.`,
            { notification_id: 'not found' },
          );
        }

        const { notification_id: _sourceId, site_id: _siteId, ...overrides } = input;
        const base = notificationToSendInput(source);
        // The original's own schedule is never reused: it is in the past for anything already
        // sent, and a copy is a new decision anyway. The caller says when this one goes.
        base.schedule_date = undefined;
        base.recurring_schedule = undefined;
        base.send_in_subscribers_timezone = undefined;
        const merged = SendNotificationInputSchema.parse({ ...base, ...overrides });

        const scheduleConversion =
          merged.schedule_timezone && merged.schedule_date && !merged.send_in_subscribers_timezone
            ? await resolveScheduleTimezone(
                client,
                siteId,
                merged.schedule_date,
                merged.schedule_timezone,
              )
            : undefined;
        const scheduledInput = scheduleConversion
          ? { ...merged, schedule_date: scheduleConversion.send_as }
          : merged;

        const filterResult = scheduledInput.subscriber_filter
          ? await resolveSubscriberFilter(
              client,
              siteId,
              scheduledInput.subscriber_filter,
              'created',
            )
          : undefined;
        const resolvedInput = filterResult
          ? { ...scheduledInput, subscriber_filter: filterResult.filter }
          : scheduledInput;

        // The copy carries the original's mobile push settings, but not its source: it really was
        // created here, so `API` is accurate for it.
        const body = applyReplayedFields(toApiBody(resolvedInput), { ...base, source: undefined });
        const created = await createNotification(client, siteId, resolvedInput, body);
        const responsePayload: Record<string, unknown> = {
          notification_id: created.notification_id,
          status: created.status,
          title: created.notification_title ?? body.notification_title,
          message: created.notification_message ?? body.notification_message,
          url: created.notification_url ?? body.notification_url,
          view_url: notificationUrl(config.dashboard_url, created.notification_id),
          duplicated_from: input.notification_id,
          changed_fields: Object.keys(overrides),
        };
        if (filterResult && filterResult.date_conversions.length > 0) {
          responsePayload.filter_date_conversions = filterResult.date_conversions;
        }
        if (!body.sche_options) {
          responsePayload.scheduled_for = created.valid_from ?? body.valid_from;
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
}
