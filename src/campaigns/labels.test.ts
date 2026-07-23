// src/campaigns/labels.test.ts
import {
  automationStatusLabel,
  dripStatusFilterCode,
  dripTypeLabel,
  rssStatusFilterCode,
  rssStatusLabel,
  triggerStatusFilterCode,
  triggerTypeLabel,
  workflowStatusFilterCode,
  workflowStatusLabel,
} from './labels';

describe('automationStatusLabel (drip + triggers)', () => {
  it('maps the known codes', () => {
    expect(automationStatusLabel('active')).toBe('Active');
    expect(automationStatusLabel('new')).toBe('Draft');
    expect(automationStatusLabel('cancelled')).toBe('Paused');
    expect(automationStatusLabel('archive')).toBe('Archive');
  });
  it('capitalizes unknowns', () => {
    expect(automationStatusLabel('weird')).toBe('Weird');
  });
});

describe('rssStatusLabel', () => {
  it('capitalizes like the dashboard', () => {
    expect(rssStatusLabel('active')).toBe('Active');
    expect(rssStatusLabel('draft')).toBe('Draft');
    expect(rssStatusLabel('pause')).toBe('Pause');
  });
});

describe('workflowStatusLabel', () => {
  it('maps the known codes', () => {
    expect(workflowStatusLabel('active')).toBe('Active');
    expect(workflowStatusLabel('inactive')).toBe('Inactive');
    expect(workflowStatusLabel('draft')).toBe('Draft');
    expect(workflowStatusLabel('deleted')).toBe('Deleted');
  });
});

describe('triggerTypeLabel', () => {
  it('maps campaign types', () => {
    expect(triggerTypeLabel('generic')).toBe('Custom Trigger');
    expect(triggerTypeLabel('browse')).toBe('Browse Abandonment');
    expect(triggerTypeLabel('trigger')).toBe('Cart Abandonment');
    expect(triggerTypeLabel('price_drop')).toBe('Price Drop');
    expect(triggerTypeLabel('inventory')).toBe('Inventory Alert');
  });
});

describe('dripTypeLabel', () => {
  it('maps drip types', () => {
    expect(dripTypeLabel('welcome')).toBe('Welcome Drip');
    expect(dripTypeLabel('generic')).toBe('Drip');
  });
});

describe('status filter codes (friendly -> raw API code)', () => {
  it('drip', () => {
    expect(dripStatusFilterCode('active')).toBe('active');
    expect(dripStatusFilterCode('draft')).toBe('new');
    expect(dripStatusFilterCode('paused')).toBe('cancelled');
    expect(dripStatusFilterCode('all')).toBeUndefined();
  });
  it('trigger (adds archive)', () => {
    expect(triggerStatusFilterCode('draft')).toBe('new');
    expect(triggerStatusFilterCode('paused')).toBe('cancelled');
    expect(triggerStatusFilterCode('archive')).toBe('archive');
    expect(triggerStatusFilterCode('all')).toBeUndefined();
  });
  it('rss', () => {
    expect(rssStatusFilterCode('active')).toBe('active');
    expect(rssStatusFilterCode('draft')).toBe('draft');
    expect(rssStatusFilterCode('paused')).toBe('pause');
    expect(rssStatusFilterCode('all')).toBeUndefined();
  });
  it('workflow', () => {
    expect(workflowStatusFilterCode('active')).toBe('active');
    expect(workflowStatusFilterCode('inactive')).toBe('inactive');
    expect(workflowStatusFilterCode('draft')).toBe('draft');
    expect(workflowStatusFilterCode('all')).toBeUndefined();
  });
});
