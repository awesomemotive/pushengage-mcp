// src/campaigns/schema.test.ts
import {
  ListDripCampaignsInputSchema,
  ListRssCampaignsInputSchema,
  ListTriggeredCampaignsInputSchema,
  ListWorkflowsInputSchema,
  asRows,
  toDripCampaign,
  toRssCampaign,
  toTriggeredCampaign,
  toWorkflow,
} from './schema';

describe('campaign input schemas', () => {
  it('default page=1, limit=10, status=all', () => {
    const result = ListDripCampaignsInputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(10);
      expect(result.data.status).toBe('all');
    }
  });

  it('rejects limit > 100', () => {
    expect(ListDripCampaignsInputSchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it('include_analytics defaults to false on drip/trigger/workflow', () => {
    for (const schema of [
      ListDripCampaignsInputSchema,
      ListTriggeredCampaignsInputSchema,
      ListWorkflowsInputSchema,
    ]) {
      const result = schema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as { include_analytics: boolean }).include_analytics).toBe(false);
      }
    }
  });

  it('each tool allows only its own status options', () => {
    // drip: all/active/draft/paused (no archive, no inactive)
    expect(ListDripCampaignsInputSchema.safeParse({ status: 'paused' }).success).toBe(true);
    expect(ListDripCampaignsInputSchema.safeParse({ status: 'archive' }).success).toBe(false);
    expect(ListDripCampaignsInputSchema.safeParse({ status: 'inactive' }).success).toBe(false);

    // trigger adds archive
    expect(ListTriggeredCampaignsInputSchema.safeParse({ status: 'archive' }).success).toBe(true);

    // rss: all/active/draft/paused
    expect(ListRssCampaignsInputSchema.safeParse({ status: 'paused' }).success).toBe(true);
    expect(ListRssCampaignsInputSchema.safeParse({ status: 'archive' }).success).toBe(false);

    // workflow: all/active/inactive/draft (no paused/archive)
    expect(ListWorkflowsInputSchema.safeParse({ status: 'inactive' }).success).toBe(true);
    expect(ListWorkflowsInputSchema.safeParse({ status: 'paused' }).success).toBe(false);
  });
});

describe('asRows', () => {
  it('handles a bare array', () => {
    expect(asRows([{ a: 1 }, { a: 2 }])).toHaveLength(2);
  });
  it('handles a { data: [...] } envelope', () => {
    expect(asRows({ data: [{ a: 1 }] })).toHaveLength(1);
  });
  it('returns [] for unexpected shapes', () => {
    expect(asRows(null)).toEqual([]);
    expect(asRows({ nope: true })).toEqual([]);
  });
});

describe('campaign normalizers (with UI-matching labels)', () => {
  it('toDripCampaign: status cancelled->Paused, drip_type welcome->Welcome Drip, keeps codes', () => {
    expect(
      toDripCampaign({
        rule_set_id: 7,
        rule_set_name: 'Welcome series',
        status: 'cancelled',
        drip_type: 'welcome',
        create_date: '2026-01-02 10:00:00',
      }),
    ).toEqual({
      id: 7,
      name: 'Welcome series',
      status: 'Paused',
      status_code: 'cancelled',
      drip_type: 'Welcome Drip',
      drip_type_code: 'welcome',
      created_at: '2026-01-02 10:00:00',
    });
  });

  it('toDripCampaign: status new->Draft, generic->Drip', () => {
    const d = toDripCampaign({ status: 'new', drip_type: 'generic' });
    expect(d.status).toBe('Draft');
    expect(d.drip_type).toBe('Drip');
  });

  it('toTriggeredCampaign: campaign_type price_drop->Price Drop, status active->Active', () => {
    expect(
      toTriggeredCampaign({
        trigger_id: 12,
        campaign_name: 'Price drop',
        campaign_type: 'price_drop',
        status: 'active',
        created_at: '2026-02-01 00:00:00',
      }),
    ).toEqual({
      id: 12,
      name: 'Price drop',
      type: 'Price Drop',
      type_code: 'price_drop',
      status: 'Active',
      status_code: 'active',
      created_at: '2026-02-01 00:00:00',
    });
  });

  it('toTriggeredCampaign: type generic->Custom Trigger, trigger->Cart Abandonment, status archive->Archive', () => {
    expect(toTriggeredCampaign({ campaign_type: 'generic', status: 'archive' })).toMatchObject({
      type: 'Custom Trigger',
      status: 'Archive',
    });
    expect(toTriggeredCampaign({ campaign_type: 'trigger' }).type).toBe('Cart Abandonment');
  });

  it('toRssCampaign: status capitalized (pause->Pause) like the dashboard', () => {
    expect(
      toRssCampaign({
        campaign_id: 3,
        campaign_name: 'Blog RSS',
        feed_url: 'https://example.com/feed',
        status: 'pause',
        created_at: '2026-03-01 00:00:00',
      }),
    ).toEqual({
      id: 3,
      name: 'Blog RSS',
      feed_url: 'https://example.com/feed',
      status: 'Pause',
      status_code: 'pause',
      created_at: '2026-03-01 00:00:00',
    });
  });

  it('toWorkflow: status inactive->Inactive, keeps run_type + code', () => {
    expect(
      toWorkflow({
        id: 99,
        name: 'Onboarding',
        status: 'inactive',
        option: { run_type: 'once' },
        created_at: '2026-04-01 00:00:00',
      }),
    ).toEqual({
      id: 99,
      name: 'Onboarding',
      status: 'Inactive',
      status_code: 'inactive',
      run_type: 'once',
      created_at: '2026-04-01 00:00:00',
    });
  });

  it('omits analytics unless includeAnalytics is true', () => {
    expect(toDripCampaign({ status: 'active' })).not.toHaveProperty('analytics');
    expect(toTriggeredCampaign({ status: 'active' })).not.toHaveProperty('analytics');
    expect(toWorkflow({ status: 'active' })).not.toHaveProperty('analytics');
  });

  it('toDripCampaign analytics: dashboard labels + goal summed across result', () => {
    const d = toDripCampaign(
      {
        rule_set_id: 1,
        status: 'active',
        analytics: { sentcount: 100, views: 40, clicks: 8, ctr: 8.5 },
        result: {
          purchase: { count: 3, value: 150 },
          signup: { count: 2, value: 0 },
        },
      },
      true,
    );
    expect(d.analytics).toEqual({
      sent: 100,
      seen: 40,
      clicked: 8,
      ctr: 8.5,
      goal_count: 5,
      goal_value: 150,
    });
  });

  it('toTriggeredCampaign analytics: defaults missing numbers to 0', () => {
    const t = toTriggeredCampaign({ trigger_id: 2, status: 'active' }, true);
    expect(t.analytics).toEqual({
      sent: 0,
      seen: 0,
      clicked: 0,
      ctr: 0,
      goal_count: 0,
      goal_value: 0,
    });
  });

  it('toWorkflow analytics: active = entered - (completed + failed), goal from result', () => {
    const w = toWorkflow(
      {
        id: 3,
        status: 'active',
        analytics: { entered_users: 100, completed_users: 30, failed_users: 10 },
        result: { goal_a: { count: 4, value: 20 } },
      },
      true,
    );
    expect(w.analytics).toEqual({
      entered: 100,
      active: 60,
      completed: 30,
      failed: 10,
      goal_count: 4,
      goal_value: 20,
    });
  });

  it('normalizers degrade gracefully on missing fields', () => {
    expect(toDripCampaign({})).toEqual({
      id: undefined,
      name: '',
      status: '',
      status_code: '',
      drip_type: '',
      drip_type_code: '',
      created_at: '',
    });
    expect(toWorkflow({}).run_type).toBe('');
  });
});
