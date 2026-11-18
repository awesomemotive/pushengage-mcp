// src/notifications/tools.test.ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { saveConfig } from '../config';
import { createServer } from '../server';

/**
 * End-to-end tests for the lifecycle tools: a real MCP client calling the real handlers, with only
 * the config file and `fetch` stubbed.
 *
 * These exist because the unit suites could not have caught what QA found. Every piece behaved;
 * the response was assembled from the wrong one. A fix that is "obviously right" in `fromApi.ts`
 * is worth nothing until something asserts what comes back out of the tool — this file asserts
 * exactly that, on the payload a client receives.
 */
describe('notification lifecycle tools, end to end', () => {
  let tmpHome: string;

  beforeEach(async () => {
    jest.restoreAllMocks();
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'pe-mcp-tools-'));
    process.env.PE_MCP_CONFIG_PATH = path.join(tmpHome, 'mcp.json');
    await saveConfig({
      api_url: 'https://app.pushengage.com',
      dashboard_url: 'https://app.pushengage.com',
      token: 'JWT',
      current_site_id: 77,
    });
  });

  afterEach(async () => {
    delete process.env.PE_MCP_CONFIG_PATH;
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  const json = (body: unknown) =>
    new Response(JSON.stringify({ data: body }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  /** Answer each request by method+path, so a test only states the calls it cares about. */
  function stubApi(routes: Array<{ match: RegExp; method?: string; body: unknown }>): {
    calls: Array<{ method: string; url: string; body?: unknown }>;
  } {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const sent = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, url, body: sent });
      const route = routes.find(
        (r) => r.match.test(url) && (r.method ?? 'GET').toUpperCase() === method,
      );
      if (!route) throw new Error(`unstubbed ${method} ${url}`);
      return json(route.body);
    });
    return { calls };
  }

  /** A site-details read, which carries the timezone under `settings.timezone.value`. */
  const siteWithTimezone = (timezone: string) => ({
    site_id: 77,
    site_name: 'Test site',
    settings: { timezone: { value: timezone } },
  });

  async function callTool(name: string, args: Record<string, unknown>) {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name, arguments: args });
    await client.close();
    await server.close();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    return { result, text, payload: result.structuredContent as Record<string, unknown> };
  }

  /** A draft targeting one audience group, as the API reads it back. */
  const DRAFT_WITH_GROUP = {
    notification_id: 169018739,
    notification_title: 'P290 C10',
    notification_message: 'body',
    notification_url: 'https://example.com',
    status: 'draft',
    source: 'API',
    notification_criteria: { audience: { op: 'or', groups: [4780], group_list: [] } },
  };

  describe('update: the audience in the response is the audience the API saved (QA F1)', () => {
    it('reports all subscribers, and the dropped group, when the group no longer exists', async () => {
      // The API answers a PATCH with the notification as it now stands. An audience group that has
      // been deleted leaves `notification_criteria` empty, and the send goes to everyone.
      stubApi([
        { match: /notifications\/169018739$/, body: DRAFT_WITH_GROUP },
        {
          match: /notifications\/169018739\?/,
          method: 'PATCH',
          body: {
            notification_id: 169018739,
            status: 'draft',
            notification_title: 'P290 C10 edited',
            notification_message: 'body',
            notification_url: 'https://example.com',
            notification_criteria: {},
          },
        },
      ]);

      const { payload } = await callTool('pushengage_update_notification', {
        notification_id: 169018739,
        title: 'P290 C10 edited',
      });

      expect(payload.audience).toContain('all subscribers');
      expect(payload.audience).toContain('4780');
      expect(payload.dropped_audience_groups).toEqual([4780]);
      // The old report printed the criteria KEY, which is what this guards against.
      expect(payload.audience).not.toBe('audience');
    });

    it('names the groups when they do survive', async () => {
      stubApi([
        { match: /notifications\/169018739$/, body: DRAFT_WITH_GROUP },
        {
          match: /notifications\/169018739\?/,
          method: 'PATCH',
          body: {
            notification_id: 169018739,
            status: 'draft',
            notification_title: 'P290 C10 edited',
            notification_criteria: { audience: { op: 'or', groups: [4780] } },
          },
        },
      ]);

      const { payload } = await callTool('pushengage_update_notification', {
        notification_id: 169018739,
        title: 'P290 C10 edited',
      });

      expect(payload.audience).toBe('audience groups: 4780');
      expect(payload.dropped_audience_groups).toBeUndefined();
    });
  });

  describe('update: a resumed recurrence says so in the response (QA F3)', () => {
    it('flags the resume when the notification was paused', async () => {
      const startDate = new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10);
      const endDate = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
      stubApi([
        {
          match: /notifications\/169014029$/,
          body: {
            notification_id: 169014029,
            notification_title: 'P290 A4',
            notification_message: 'body',
            notification_url: 'https://example.com',
            status: 'pause_repeat_scheduled',
            source: 'repeat_scheduled',
            sche_options: {
              schedule_days: ['monday'],
              schedule_time: ['09:00'],
              schedule_start_date: startDate,
              schedule_end_date: endDate,
            },
          },
        },
        {
          match: /notifications\/169014029\?/,
          method: 'PATCH',
          body: { notification_id: 169014029, status: 'repeat_scheduled' },
        },
      ]);

      const { payload } = await callTool('pushengage_update_notification', {
        notification_id: 169014029,
        title: 'P290 A4 edited',
      });

      expect(payload.resumed_from_paused).toBe(true);
    });

    it('says nothing about resuming for an ordinary draft', async () => {
      stubApi([
        { match: /notifications\/169018739$/, body: DRAFT_WITH_GROUP },
        {
          match: /notifications\/169018739\?/,
          method: 'PATCH',
          body: { notification_id: 169018739, status: 'draft' },
        },
      ]);
      const { payload } = await callTool('pushengage_update_notification', {
        notification_id: 169018739,
        title: 'x',
      });
      expect(payload.resumed_from_paused).toBeUndefined();
    });
  });

  describe("update: a recurrence's start date is judged in the site's calendar (QA F2)", () => {
    // Fixed clock, because the whole point is which calendar the date is read in. At 02:00 UTC the
    // site timezone decides what "today" is: still the 10th in Los Angeles, already the 11th in UTC.
    const AT_0200_UTC = new Date('2026-11-11T02:00:00Z').getTime();

    beforeEach(() => {
      jest.useFakeTimers({ now: AT_0200_UTC, doNotFake: ['nextTick', 'setImmediate'] });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const recurring = (startDate: string) => ({
      notification_id: 169016001,
      notification_title: 'P290 C4',
      notification_message: 'body',
      notification_url: 'https://example.com',
      status: 'repeat_scheduled',
      source: 'repeat_scheduled',
      sche_options: {
        schedule_days: ['monday'],
        schedule_time: ['09:00'],
        schedule_start_date: startDate,
        schedule_end_date: '2027-01-01',
      },
    });

    it('refuses with the clear message when the recurrence started yesterday', async () => {
      // QA F2: the day of slack the UTC comparison carried let this through to the API, which
      // answered with the raw "schedule start date should be greater than current date".
      const { calls } = stubApi([
        { match: /notifications\/169016001$/, body: recurring('2026-11-10') },
        { match: /sites\/77\?setting_name/, body: siteWithTimezone('UTC') },
      ]);

      const { text, result } = await callTool('pushengage_update_notification', {
        notification_id: 169016001,
        title: 'P290 C4 edited',
      });

      expect(result.isError).toBe(true);
      expect(text).toContain('started on 2026-11-10');
      expect(text).toContain('start_date of today or later');
      // No PATCH was attempted, and the verdict really came from the site's calendar.
      expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
      expect(calls.some((c) => /sites\/77\?setting_name/.test(c.url))).toBe(true);
    });

    it('allows a date that is still today where the site lives, though UTC has moved on', async () => {
      // The other half of the same boundary, raised in review: refusing this would be stricter
      // than the API, which compares end-of-day in the site's timezone and would accept it.
      const { calls } = stubApi([
        { match: /notifications\/169016001$/, body: recurring('2026-11-10') },
        { match: /sites\/77\?setting_name/, body: siteWithTimezone('America/Los_Angeles') },
        {
          match: /notifications\/169016001\?/,
          method: 'PATCH',
          body: { notification_id: 169016001, status: 'repeat_scheduled' },
        },
      ]);

      const { result } = await callTool('pushengage_update_notification', {
        notification_id: 169016001,
        title: 'P290 C4 edited',
      });

      expect(result.isError).toBeFalsy();
      // Vacuous otherwise: without the site lookup the lenient fallback would also let this pass.
      expect(calls.some((c) => /sites\/77\?setting_name/.test(c.url))).toBe(true);
    });

    it('does not read the site at all for a start date long past', async () => {
      const { calls } = stubApi([
        { match: /notifications\/169016001$/, body: recurring('2026-01-01') },
      ]);

      const { result } = await callTool('pushengage_update_notification', {
        notification_id: 169016001,
        title: 'P290 C4 edited',
      });

      expect(result.isError).toBe(true);
      expect(calls.some((c) => /sites\/77\?setting_name/.test(c.url))).toBe(false);
    });

    it('falls back to the lenient comparison when the site timezone cannot be read', async () => {
      // A site lookup that fails must never cost someone an edit the API would have accepted, so
      // the old day-of-slack comparison stands in and the API gets the final word.
      stubApi([
        { match: /notifications\/169016001$/, body: recurring('2026-11-10') },
        { match: /sites\/77\?setting_name/, body: { site_id: 77, settings: {} } },
        {
          match: /notifications\/169016001\?/,
          method: 'PATCH',
          body: { notification_id: 169016001, status: 'repeat_scheduled' },
        },
      ]);

      const { result } = await callTool('pushengage_update_notification', {
        notification_id: 169016001,
        title: 'P290 C4 edited',
      });

      expect(result.isError).toBeFalsy();
    });
  });

  describe('resend: the response names the NEW notification (QA F4)', () => {
    it('reads the new id out of an A/B resend response', async () => {
      // An A/B resend answers `{ ab, A, B }` — the new A-variant id is nested, not top level.
      stubApi([
        {
          match: /notifications\/169018729$/,
          body: {
            ab: { ab_notification_id: 55, status: 'sent' },
            A: {
              notification_id: 169018729,
              notification_title: 'P290 B2',
              status: 'sent',
              source: 'A',
            },
            B: { notification_id: 169018730, status: 'sent' },
          },
        },
        {
          match: /notifications\/169018729\/resend$/,
          method: 'POST',
          body: {
            ab: { ab_notification_id: 56, status: 'sent' },
            A: { notification_id: 169018737, status: 'sent' },
            B: { notification_id: 169018738, status: 'sent' },
          },
        },
      ]);

      const { payload } = await callTool('pushengage_resend_notification', {
        notification_id: 169018729,
      });

      expect(payload.notification_id).toBe(169018737);
      expect(payload.resent_from).toBe(169018729);
      expect(payload.view_url).toContain('169018737');
      expect(payload.ab_notification_id).toBe(56);
    });

    it('still reports a plain resend from the flat response', async () => {
      stubApi([
        {
          match: /notifications\/169018700$/,
          body: {
            notification_id: 169018700,
            notification_title: 'P290 B1',
            status: 'sent',
            source: 'API',
          },
        },
        {
          match: /notifications\/169018700\/resend$/,
          method: 'POST',
          body: { notification_id: 169018742, status: 'sent' },
        },
      ]);

      const { payload } = await callTool('pushengage_resend_notification', {
        notification_id: 169018700,
      });

      expect(payload.notification_id).toBe(169018742);
      expect(payload.ab_notification_id).toBeUndefined();
    });
  });
});
