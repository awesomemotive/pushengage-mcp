// src/notifications/tools.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { errorResult } from '../http/errors';
import { resolveContext } from '../context';
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
        'Audience: by default sends to all subscribers. Pass `audience_groups` (array of 1-20 predefined audience-group IDs) only when the user mentions a saved/predefined audience group. ' +
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
        const body = toApiBody(input);
        const created = await createNotification(client, siteId, input, body);
        const viewUrl = `${config.dashboard_url}/sites/${siteId}/notifications/${created.notification_id}`;
        const responsePayload: Record<string, unknown> = {
          notification_id: created.notification_id,
          // For recurring sends, the API flips this to 'repeat_scheduled' on save.
          status: created.status,
          title: created.notification_title ?? body.notification_title,
          message: created.notification_message ?? body.notification_message,
          url: created.notification_url ?? body.notification_url,
          view_url: viewUrl,
        };
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
        'Audience: by default sends to all subscribers. Pass `audience_groups` (1-20 predefined audience-group IDs) only when the user mentions a saved/predefined audience group. ' +
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
        const body = toAbApiBody(input);
        const created = await createAbNotification(client, siteId, input, body);
        // A/B notifications surface in the dashboard under the ab_notification_id, falling back
        // to the variant-A notification_id when the API doesn't return the pair id.
        const idForLink = created.ab_notification_id ?? created.notification_id;
        const viewUrl = `${config.dashboard_url}/sites/${siteId}/notifications/${idForLink}`;
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
