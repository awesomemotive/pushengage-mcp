# Changelog

All notable changes to `@pushengage/mcp` are documented in this file.

## [1.1.0] - 2026-11-10

### Added

- **Send to a custom audience.** `subscriber_filter` on `pushengage_send_notification` and `pushengage_send_ab_notification` targets by segment, subscriber attribute, location, device, browser, subscription and engagement dates, and sent/view/click counts — the dashboard's "Send to Custom Audience" option. Use it or `audience_groups`, not both.
- **Segment names, not just IDs.** Names work anywhere a segment rule takes an ID, in the send tools and in `pushengage_create_audience_group`. A name or attribute key that does not exist on the site fails the call, so a typo cannot quietly send to everyone.
- **`pushengage_list_audience_filter_values`** — the location and device values a site actually has, with subscriber counts, so filters can be built from real values.
- **Timezones.** `schedule_timezone` lets you give `schedule_date` in your own IANA timezone and have it converted to the site's. `subscriber_filter.timezone` reads the filter's date values in that timezone instead of UTC. Both report what was converted; omit them and nothing changes.

### Changed

- **Node 20 or newer is now required** (was 18). Node 18 reached end of life on 30 April 2025; CI covers 20, 22 and 24. Installing on Node 18 warns with `EBADENGINE` — an existing install keeps working, but it is no longer supported or tested.
- Subscriber-filter rules now follow the dashboard's per-field operator rules, and values are checked before sending, so a combination that would match nobody is rejected rather than accepted.
- The singular `segment` filter field is no longer accepted — use `segments`.

### Fixed

- `lhm.plugin.json` is generated from the running server, so its tool list cannot drift from the tools the server registers.

## [1.0.0] - 2026-07-23

Initial public release of the PushEngage MCP server.

### Added

- Browser-based authentication flow with local token storage (`pushengage_auth_login`, `pushengage_auth_status`, `pushengage_auth_logout`).
- Site management: list accessible sites and select the current site used by all site-scoped tools (`pushengage_list_sites`, `pushengage_select_site`).
- Site settings tools for site details, campaign defaults, and service worker settings (get/update pairs).
- Audience tools: segments, audience groups, and custom subscriber attributes (list/create pairs).
- Campaign and automation listing tools: drip campaigns, triggered campaigns, RSS auto push campaigns, and workflows, with optional per-campaign analytics.
- Chat widget listing (`pushengage_list_chat_widgets`).
- Analytics tools: lifetime summary and per-bucket timeseries over a date range.
- Notification tools: list sent/scheduled/draft notifications, send or schedule a notification (now, one-shot, or recurring, with optional audience-group targeting), and send A/B notifications with optional intelligent A/B testing.
- `server.json` manifest for the MCP registry (`io.github.awesomemotive/pushengage-mcp`).
- Guided publish script (`npm run publish:guided`) that verifies `server.json` and `package.json` versions match before publishing.
- Configuration via `PE_MCP_CONFIG_PATH` (token/config file location, enables running multiple accounts side by side) and `PE_MCP_CLIENT_NAME` (label shown on the authorize screen).

[1.1.0]: https://github.com/awesomemotive/pushengage-mcp/releases/tag/v1.1.0
[1.0.0]: https://github.com/awesomemotive/pushengage-mcp/releases/tag/v1.0.0
