# Changelog

All notable changes to `@pushengage/mcp` are documented in this file.

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

[1.0.0]: https://github.com/awesomemotive/pushengage-mcp/releases/tag/v1.0.0
