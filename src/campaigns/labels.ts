// src/campaigns/labels.ts
//
// The campaign list APIs return terse status/type codes; the dashboard renders friendlier
// labels. These maps mirror the dashboard exactly so the MCP shows the same wording a user sees
// in the UI. Sources in pushengage-app:
//   - drip/trigger status  → components/campaigns/automation/AutomationStatus.tsx
//   - rss status           → components/campaigns/rssFeedCampaign/* (capitalize(status))
//   - workflow status      → components/workflow/workflowHelper.ts (workflowStatusLabelMap)
//   - trigger type         → constants/index.ts (triggeredCampaignTypeLabels)
//   - drip type            → constants/index.ts (DRIP_TYPE) + DripTable "Welcome Drip" badge

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

// Drip + triggered campaigns share the automation status vocabulary. Note the API stores a
// paused automation as `cancelled`, and triggers can also be `archive`.
const AUTOMATION_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  new: 'Draft',
  cancelled: 'Paused',
  archive: 'Archive',
};

export function automationStatusLabel(raw: string): string {
  return AUTOMATION_STATUS_LABELS[raw] ?? capitalize(raw);
}

// RSS statuses are `active` / `draft` / `pause`; the dashboard just capitalizes them.
export function rssStatusLabel(raw: string): string {
  return capitalize(raw);
}

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  inactive: 'Inactive',
  draft: 'Draft',
  deleted: 'Deleted',
};

export function workflowStatusLabel(raw: string): string {
  return WORKFLOW_STATUS_LABELS[raw] ?? capitalize(raw);
}

const TRIGGER_TYPE_LABELS: Record<string, string> = {
  generic: 'Custom Trigger',
  browse: 'Browse Abandonment',
  trigger: 'Cart Abandonment',
  price_drop: 'Price Drop',
  inventory: 'Inventory Alert',
};

export function triggerTypeLabel(raw: string): string {
  return TRIGGER_TYPE_LABELS[raw] ?? capitalize(raw);
}

const DRIP_TYPE_LABELS: Record<string, string> = {
  welcome: 'Welcome Drip',
  generic: 'Drip',
};

export function dripTypeLabel(raw: string): string {
  return DRIP_TYPE_LABELS[raw] ?? capitalize(raw);
}

// ---- status filter mapping (friendly filter value -> raw API status code) -----
//
// The dashboard list pages filter by status with tabs: All (no filter) + per-type options.
// The MCP exposes the same friendly values; these maps translate them to the raw `status` query
// param each list endpoint expects. `all` (and anything unmapped) returns undefined = no filter.
// Sources: the `navData` tabs in pushengage-app's campaigns/*/List.tsx pages.

const DRIP_STATUS_FILTER: Record<string, string> = {
  active: 'active',
  draft: 'new',
  paused: 'cancelled',
};

const TRIGGER_STATUS_FILTER: Record<string, string> = {
  active: 'active',
  draft: 'new',
  paused: 'cancelled',
  archive: 'archive',
};

const RSS_STATUS_FILTER: Record<string, string> = {
  active: 'active',
  draft: 'draft',
  paused: 'pause',
};

const WORKFLOW_STATUS_FILTER: Record<string, string> = {
  active: 'active',
  inactive: 'inactive',
  draft: 'draft',
};

export function dripStatusFilterCode(value: string): string | undefined {
  return DRIP_STATUS_FILTER[value];
}
export function triggerStatusFilterCode(value: string): string | undefined {
  return TRIGGER_STATUS_FILTER[value];
}
export function rssStatusFilterCode(value: string): string | undefined {
  return RSS_STATUS_FILTER[value];
}
export function workflowStatusFilterCode(value: string): string | undefined {
  return WORKFLOW_STATUS_FILTER[value];
}
