// src/campaigns/api.test.ts
import type { ApiClient } from '../http/client';
import { __testing__, listDripCampaigns, listTriggeredCampaigns, listWorkflows } from './api';

const { buildQuery } = __testing__;

describe('buildQuery', () => {
  it('omits status and expand by default', () => {
    expect(buildQuery({ limit: 10, page: 1 })).toBe('limit=10&page=1');
  });

  it('includes status when provided', () => {
    expect(buildQuery({ limit: 10, page: 2, status: 'active' })).toBe(
      'limit=10&page=2&status=active',
    );
  });

  it('adds expand only when includeAnalytics is true', () => {
    expect(buildQuery({ limit: 10, page: 1, includeAnalytics: false }, 'analytics')).toBe(
      'limit=10&page=1',
    );
    expect(buildQuery({ limit: 10, page: 1, includeAnalytics: true }, 'analytics')).toContain(
      'expand=analytics',
    );
  });

  it('never adds expand without an expand value, even when includeAnalytics is true', () => {
    expect(buildQuery({ limit: 10, page: 1, includeAnalytics: true })).toBe('limit=10&page=1');
  });
});

/** Minimal fake client that records the path it was called with and returns a fixed body. */
function fakeClient(body: unknown): { client: ApiClient; calls: string[] } {
  const calls: string[] = [];
  const client = {
    get: async (path: string) => {
      calls.push(path);
      return body;
    },
  } as unknown as ApiClient;
  return { client, calls };
}

describe('list functions request expand + surface analytics', () => {
  it('listDripCampaigns: no expand and no analytics when includeAnalytics is off', async () => {
    const { client, calls } = fakeClient([{ rule_set_id: 1, status: 'active' }]);
    const result = await listDripCampaigns(client, 30, { limit: 10, page: 1 });
    expect(calls[0]).not.toContain('expand=');
    expect(result.campaigns[0]).not.toHaveProperty('analytics');
  });

  it('listDripCampaigns: requests notification_analytics expand and attaches analytics', async () => {
    const { client, calls } = fakeClient([
      {
        rule_set_id: 1,
        status: 'active',
        analytics: { sentcount: 50, views: 20, clicks: 5, ctr: 10 },
        result: { g: { count: 2, value: 99 } },
      },
    ]);
    const result = await listDripCampaigns(client, 30, {
      limit: 10,
      page: 1,
      includeAnalytics: true,
    });
    expect(calls[0]).toContain('expand=notification_analytics%2Cresult_analytics');
    expect(result.campaigns[0].analytics).toEqual({
      sent: 50,
      seen: 20,
      clicked: 5,
      ctr: 10,
      goal_count: 2,
      goal_value: 99,
    });
  });

  it('listTriggeredCampaigns: requests notification_analytics expand', async () => {
    const { client, calls } = fakeClient([]);
    await listTriggeredCampaigns(client, 30, { limit: 10, page: 1, includeAnalytics: true });
    expect(calls[0]).toContain('expand=notification_analytics%2Cresult_analytics');
  });

  it('listWorkflows: requests analytics expand and attaches workflow analytics', async () => {
    const { client, calls } = fakeClient([
      {
        id: 1,
        status: 'active',
        analytics: { entered_users: 100, completed_users: 30, failed_users: 10 },
        result: { g: { count: 4, value: 20 } },
      },
    ]);
    const result = await listWorkflows(client, 30, {
      limit: 10,
      page: 1,
      includeAnalytics: true,
    });
    expect(calls[0]).toContain('expand=analytics%2Cresult_analytics');
    expect(result.workflows[0].analytics).toEqual({
      entered: 100,
      active: 60,
      completed: 30,
      failed: 10,
      goal_count: 4,
      goal_value: 20,
    });
  });
});
