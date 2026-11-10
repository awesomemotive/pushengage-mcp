# Changelog

All notable changes to `@pushengage/mcp` are documented in this file.

## [1.1.0] - 2026-11-04

### Added

- Custom-audience targeting on the send tools: `subscriber_filter` on `pushengage_send_notification` and `pushengage_send_ab_notification`, exposing the dashboard's third audience option ("Send to Custom Audience"). Targets by segment, subscriber attribute, location, device, browser, subscription/engagement date, and sent/view/click counts. Mutually exclusive with `audience_groups`.
- `pushengage_list_audience_filter_values` — the location and device values recorded on a site, with active-subscriber counts, for the `country` / `state` / `city` / `device` / `device_type` filter fields. Locations are per-site display names rather than ISO codes, so they cannot be enumerated statically.
- `subscriber_filter.timezone`: date values inside a custom-audience filter (`ts_created`, `ts_last_sent`, `ts_last_click`, `ts_last_view` with an absolute operator, and `dt_gt` / `dt_lt`) are interpreted as **UTC** by the API — the filter branch converts nothing, unlike the legacy criteria branch. Setting `timezone` to an IANA zone reinterprets naive date values from it into UTC before sending, and the response reports each conversion. Values already carrying `Z` or an offset are left as given, and relative windows (`ts_elapsed_*`, which are a count of **minutes**) carry no timezone at all, so they are untouched.
- `schedule_timezone` on both send tools: give `schedule_date` in your own IANA timezone and it is converted to the site's wall clock before sending, with the response reporting the requested time, the stored time, both UTC offsets, and the UTC equivalent. A bare `schedule_date` is read by the API as the *site's* local time, so without this a time meant in one zone silently scheduled in another. Ambiguous abbreviations (IST, PST, EST) are rejected — `Intl` accepts them but pins them to a fixed offset with no daylight saving.
- Segment names are accepted wherever a segment rule takes IDs, and are resolved against the site before anything is sent. Attribute keys are verified the same way. An unresolvable reference fails the call instead of dispatching — the API silently drops unknown segment references, and a filter that drops to nothing is treated as "all subscribers", so a mistyped segment name would otherwise push to every subscriber.

### Changed

- `pushengage_create_audience_group` shares the same filter schema and resolver, so segment names work there too and the operator rules are identical across all three tools.
- Subscriber-filter rules now enforce the dashboard's per-field operator matrix (for example `country` accepts only `in` / `nin`; `segments` accepts `in` / `all` / `nin`). Previously any operator was accepted on any field, which the API also accepts but which silently matches nobody.
- A `key` property on a non-`attributes` rule is now rejected rather than accepted and ignored.
- Subscriber-filter values are validated against the API's own typing, audited against the Adonis validators: attribute `key` now enforces the API's format and 64-character cap, `dt_gt` / `dt_lt` require an ISO 8601 date, and an absolute comparison on a `ts_*` field requires a date rather than a bare number (the error points at `ts_elapsed_lt` / `ts_elapsed_gt` for relative windows).
- The singular `segment` field is no longer accepted; use `segments`.

### Fixed

- `lhm.plugin.json` is regenerated from the running server, so its tool list and input schemas no longer drift from what the server registers.

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
