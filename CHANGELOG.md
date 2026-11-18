# Changelog

All notable changes to `@pushengage/mcp` are documented in this file.

## [1.2.0] - 2026-11-18

### Added

- **Four tools for a notification's life after it is created**, all gated on the states the API actually allows (the full matrix is in docs/KNOWLEDGE.md):
  - `pushengage_update_notification` — edit a draft, scheduled or recurring notification. Pass only the fields to change; everything else is carried over, because the API's update is a full replace rather than a patch. A draft is promoted to a real send with `status: "sent"`.
  - `pushengage_duplicate_notification` — create a new notification from an existing one, reusing its content and audience with any field overridden. Works from any notification including a sent or deleted one; the copy is saved as a draft unless you ask for it to go out.
  - `pushengage_delete_notification` — cancel a draft, scheduled or recurring notification. Anything already sent keeps its delivery record and cannot be deleted.
  - `pushengage_resend_notification` — send an already-sent notification again, exactly as stored. The response reports the new notification's id.
- Editing an A/B test is refused rather than attempted: the API reads an update without A/B content as "remove the test" and deletes the variants.

### Changed

- **Node 24 or newer is now required** (was 20). Node 20 reached end of life in April 2026 and 22 is in maintenance, so 24 is the oldest line still receiving fixes; CI covers 24 and 26. Note this is a breaking change despite the minor version: `npx @pushengage/mcp` on Node 20 or 22 now warns with `EBADENGINE`, and nothing older than 24 is tested. Pin `@pushengage/mcp@1.1.0` if you cannot move off an older runtime yet.
- **zod 4** (was zod 3). The only fix for a high-severity advisory affecting every zod 3 release — zod can exhaust memory validating oversized constrained collections — as there is no patched 3.x. Every tool's input schema is unchanged in the respects an assistant reads: properties, required fields, descriptions, types and constraints are identical once `$ref` indirection is resolved. The one difference is that the published JSON Schema no longer carries `additionalProperties: false`; unknown keys are still stripped when the input is parsed, so nothing is accepted that was not accepted before.

### Fixed

- Patched every vulnerable package in the runtime dependency tree, all reached through the MCP SDK: a critical advisory in `proxy-addr` and high-severity ones in the SDK itself (OAuth credential handling, unbounded request bodies), `hono`, `@hono/node-server`, `body-parser`, `ip-address` and `fast-uri`. `npm audit --omit=dev` now reports none. The low-severity findings that remain on a fresh install are dev-only and have no published fix — see docs/KNOWLEDGE.md.
- `npm install` no longer warns about unapproved install scripts; `esbuild` and `fsevents` are declared in `allowScripts`.
- The tool catalogues in `lhm.plugin.json` (plugin directory) and `manifest.json` (the `.mcpb` bundle) are regenerated from the server: they listed 28 and 27 tools against the 32 registered, and still described `ts_elapsed_*` in seconds — the unit corrected in 1.1.0. `npm run generate:manifests` now produces both, so neither can drift again.

## [1.1.0] - 2026-11-10

### Added

- **Send to a custom audience.** `subscriber_filter` on `pushengage_send_notification` and `pushengage_send_ab_notification` targets by segment, subscriber attribute, location, device, browser, subscription and engagement dates, and sent/view/click counts — the dashboard's "Send to Custom Audience" option. Use it or `audience_groups`, not both.
- **Segment names, not just IDs.** Names work anywhere a segment rule takes an ID, in the send tools and in `pushengage_create_audience_group`. A name or attribute key that does not exist on the site fails the call, so a typo cannot quietly send to everyone.
- **`pushengage_list_audience_filter_values`** — the location and device values a site actually has, with subscriber counts, so filters can be built from real values.
- **Timezones.** `schedule_timezone` lets you give `schedule_date` in your own IANA timezone and have it converted to the site's. `subscriber_filter.timezone` reads the filter's date values in that timezone instead of UTC. Both report what was converted; omit them and nothing changes.

### Changed

- **Node 20 or newer is now required** (was 18). Node 18 reached end of life on 30 April 2025, so it no longer receives security fixes and CI no longer tests it. Installing on Node 18 warns with `EBADENGINE` — an existing install keeps working, but it is no longer supported or tested.
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
