// src/chatWidgets/labels.ts
//
// Label maps for chat widgets. These mirror the dashboard's vocabulary so the MCP shows the same
// wording a user sees on the chat-widget list page (status badges, channel names, device names).

/** Channel type -> display label (mirrors the dashboard channel catalog). */
const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  messenger: 'Messenger',
  phone: 'Phone',
  email: 'Email',
  instagram_dm: 'Instagram DM',
  instagram_page: 'Instagram Page',
  sms: 'SMS',
  line: 'Line',
  telegram: 'Telegram',
  google_maps: 'Google Maps',
  viber: 'Viber',
  twitter: 'X (Twitter)',
  wechat: 'WeChat',
  snapchat: 'Snapchat',
  tiktok: 'TikTok',
  waze: 'Waze',
  linkedin: 'Linkedin',
  vkontakte: 'Vkontakte',
  slack: 'Slack',
  discord: 'Discord',
  microsoft_teams: 'Microsoft Teams',
  custom: 'Custom Link',
};

/** Humanize an unknown code: "google_maps" -> "Google Maps". */
function humanize(code: string): string {
  return code
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function channelTypeLabel(type: string): string {
  return CHANNEL_LABELS[type] ?? (type ? humanize(type) : '');
}

const DEVICE_LABELS: Record<string, string> = {
  desktop: 'Desktop',
  mobile: 'Mobile',
  tablet: 'Tablet',
};

export function deviceLabel(device: string): string {
  return DEVICE_LABELS[device] ?? (device ? humanize(device) : '');
}

/** Widget status code -> dashboard badge label. `enabled` shows as "Active", `disabled` as "Inactive". */
export function chatWidgetStatusLabel(status: string): string {
  if (status === 'enabled') return 'Active';
  if (status === 'disabled') return 'Inactive';
  return status ? humanize(status) : '';
}

/** Friendly filter value (all/active/inactive) -> raw API status code, or undefined for "all". */
export function chatWidgetStatusFilterCode(
  status: 'all' | 'active' | 'inactive',
): 'enabled' | 'disabled' | undefined {
  if (status === 'active') return 'enabled';
  if (status === 'inactive') return 'disabled';
  return undefined;
}
