# @pushengage/mcp

> Manage your [PushEngage](https://www.pushengage.com/) account from any AI assistant, in plain language.

[PushEngage](https://www.pushengage.com/) is a push notification platform for web push, mobile app push, WhatsApp, and on-site chat widgets, used to grow subscribers and recover revenue (cart abandonment, price drops, back-in-stock, and more).

This package is a [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server. It connects MCP-capable assistants such as Claude Desktop, Claude Code, and Cursor to your PushEngage account so you can send and schedule notifications, run A/B tests, build audiences, inspect analytics, and manage site settings just by asking, without leaving your chat.

You log in once through your browser; the assistant then acts on your behalf against whichever PushEngage site you select.

## Contents

- [What you can do](#what-you-can-do)
- [Requirements](#requirements)
- [Install](#install)
- [First run: logging in](#first-run-logging-in)
- [Tools](#tools)
- [Configuration](#configuration)
- [Security and token storage](#security-and-token-storage)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## What you can do

Once connected, just describe what you want. A few examples:

**Send and schedule**
- "Send a notification titled 'Sale ends tonight', message 'Last call, 50% off', linking to https://example.com/sale."
- "Schedule that for 9 AM in each subscriber's local timezone."
- "Set up a recurring digest every Monday and Thursday at 8 AM through the end of the month."
- "Run an A/B test of two headlines and auto-roll-out the winner by click rate."

**Target the right people**
- "Create a segment for visitors of /pricing."
- "Build an audience of gold-plan customers in the US and send only to them."

**Understand performance**
- "How many subscribers do I have, and what was my click rate over the last 30 days?"
- "List my active drip campaigns with their sent, seen, and clicked stats."

**Configure a site**
- "Set my default notification expiry to 7 days."
- "Change my site timezone to Asia/Kolkata and turn on geolocation."

## Requirements

- A [PushEngage](https://www.pushengage.com/) account (free or paid) with at least one site.
- Node.js 18 or newer (the assistant runs the server via `npx`).
- An MCP-capable client (Claude Desktop, Claude Code, Cursor, or any other).

## Install

Add the server to your client's MCP config. No global install is needed; `npx` fetches it on demand.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your platform:

```json
{
  "mcpServers": {
    "pushengage": {
      "command": "npx",
      "args": ["-y", "@pushengage/mcp"]
    }
  }
}
```

Restart Claude Desktop. The "pushengage" server should appear in your tool list.

### Cursor

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "pushengage": {
      "command": "npx",
      "args": ["-y", "@pushengage/mcp"]
    }
  }
}
```

### Other MCP clients

Any client that speaks MCP over stdio works. Configure it to run the command `npx -y @pushengage/mcp`.

## First run: logging in

Authentication is browser-based, so your credentials never touch the assistant.

1. Ask: **"Log me into PushEngage."** The server opens a browser tab to the PushEngage authorize page.
2. Click **Authorize**. The tab confirms success and an access token is saved locally.
3. Ask: **"Show my PushEngage sites,"** then **"Use site 12345"** to pick the site to work with. The selection is remembered across restarts.

Every site-scoped tool acts on this current site unless you pass an explicit `site_id`. When the token expires you will see an `AUTH_EXPIRED` message; just ask to log in again.

## Tools

All site-scoped tools default to the current site.

### Authentication and sites

| Tool | Purpose |
|---|---|
| `pushengage_auth_login` | Opens the browser to PushEngage and stores the token on success. |
| `pushengage_auth_status` | Shows whether you are authenticated and which site is selected. |
| `pushengage_auth_logout` | Deletes the locally stored token. |
| `pushengage_list_sites` | Lists the PushEngage sites you can access. |
| `pushengage_select_site` | Sets the current site used by the other tools. |

### Site settings

| Tool | Purpose |
|---|---|
| `pushengage_get_site_details` / `pushengage_update_site_details` | Site name, URL, timezone, geolocation, and the "Powered By PushEngage" branding toggle. |
| `pushengage_get_campaign_defaults` / `pushengage_update_campaign_defaults` | UTM parameters, fallback notification, fallback attributes, and default notification expiry. Updates merge over current values, so partial edits work. |
| `pushengage_get_service_worker_settings` / `pushengage_update_service_worker_settings` | Service worker registration, sub-folder support, and the worker file path. |

### Audiences

| Tool | Purpose |
|---|---|
| `pushengage_list_segments` / `pushengage_create_segment` | URL-rule based subscriber segments. |
| `pushengage_list_audience_groups` / `pushengage_create_audience_group` | Saved targeting groups (device, country, segment, engagement, dates, attributes). Referenced by the send tools' `audience_groups`. |
| `pushengage_list_attributes` / `pushengage_create_attribute` | Custom subscriber attribute keys used in audience-group rules (max 50 per site). |

### Campaigns and automations

| Tool | Purpose |
|---|---|
| `pushengage_list_drip_campaigns` | Drip autoresponders. Filter by status; set `include_analytics` for per-campaign stats. |
| `pushengage_list_triggered_campaigns` | Triggered campaigns (cart/browse abandonment, price drop, etc.). Filter by status; optional analytics. |
| `pushengage_list_rss_campaigns` | RSS auto push campaigns. Filter by status. |
| `pushengage_list_workflows` | Workflow automations. Filter by status; set `include_analytics` for entered/active/completed/failed and goal stats. |

### Chat widgets

| Tool | Purpose |
|---|---|
| `pushengage_list_chat_widgets` | The on-site widget that surfaces WhatsApp, Messenger, and other channels. Shows status, channels, devices, business-hours restriction, and targeting. |

### Analytics

| Tool | Purpose |
|---|---|
| `pushengage_get_analytics_summary` | Lifetime totals: subscribers, notifications sent, views, clicks, and goal count/value. |
| `pushengage_get_analytics_timeseries` | Per-bucket (day/week/month) subscribers, sends, views, clicks, CTR, and unsubscribes over a date range. |

### Sending notifications

| Tool | Purpose |
|---|---|
| `pushengage_list_notifications` | Lists sent, scheduled, and draft notifications, newest first. Filter by status (dashboard-tab semantics), sent-date range, or tags; set `include_analytics` for rolled-up A/B and timezone-send stats. |
| `pushengage_send_notification` | Sends or schedules a notification. One tool, three delivery modes: send now, one-shot schedule (optionally per-subscriber timezone), and recurring. Optional `audience_groups` targeting; otherwise all subscribers. |
| `pushengage_send_ab_notification` | An A/B notification with two variants. Pass `intelligent_ab_test` to sample each variant, pick the winner by click rate after a delay, and roll the winner out to the rest. |

## Configuration

No configuration is required — the server talks to PushEngage's production API out of the box. These environment variables are available for less common setups:

| Env var | Default | Purpose |
|---|---|---|
| `PE_MCP_CLIENT_NAME` | `AI assistant` | Label shown on the authorize screen as the requesting app. Set it if you want a specific label, e.g. `"Claude Desktop"`. |
| `PE_MCP_CONFIG_PATH` | `~/.pushengage/mcp.json` | Where the token is stored. Set this to run more than one PushEngage account side by side (see below). Must be an absolute path — it's used exactly as given, with no `~` expansion. |

### Running multiple PushEngage accounts side by side

Register the server under two different names, each with its own `PE_MCP_CONFIG_PATH` so the tokens don't collide:

```json
{
  "mcpServers": {
    "pushengage-client-a": {
      "command": "npx",
      "args": ["-y", "@pushengage/mcp"],
      "env": {
        "PE_MCP_CONFIG_PATH": "/Users/you/.pushengage/mcp-client-a.json",
        "PE_MCP_CLIENT_NAME": "Claude Desktop (Client A)"
      }
    },
    "pushengage-client-b": {
      "command": "npx",
      "args": ["-y", "@pushengage/mcp"],
      "env": {
        "PE_MCP_CONFIG_PATH": "/Users/you/.pushengage/mcp-client-b.json",
        "PE_MCP_CLIENT_NAME": "Claude Desktop (Client B)"
      }
    }
  }
}
```

Ask the assistant to log in under each server name separately; each authorizes against whichever PushEngage account you choose in the browser.

## Security and token storage

- Login is browser-based. The assistant never sees your PushEngage password.
- The dashboard sends the token to the server as a POST request, so it never appears in a URL, browser history, or access log.
- The token is stored at `~/.pushengage/mcp.json` with `0600` permissions (readable only by you). Its expiry is set by PushEngage and is shown by `pushengage_auth_status`.
- To revoke it, run `pushengage_auth_logout` or log out of all sessions in PushEngage under Settings → Security.

## Troubleshooting

### The server won't connect at all ("Connection closed")

If `npx -y @pushengage/mcp` runs fine when you type it directly in a terminal, but your client (Claude Desktop, Cursor, etc.) shows the server as disconnected or logs something like `MCP error -32000: Connection closed`, this is almost always a `PATH` problem, not a bug in the server.

These clients are launched from your Dock/Finder, not from a terminal, so they never load your shell's startup files (`.zshrc`, `.zprofile`, etc). If Node was installed via a version manager (`nvm`, `fnm`, `volta`, ...), those tools only add `node`/`npx` to `PATH` from inside those startup files — so the client can't find `npx` at all, the server process never starts, and you get a generic connection error instead of a clear "command not found."

**Fix:** point the client at the absolute path to `npx` (this skips the `PATH` lookup for finding it) and also pass that same folder as `PATH` in `env` (so `npx`'s own `#!/usr/bin/env node` shebang can find `node` when it re-execs). Run `which npx` in your terminal to get the path, then use it in your client's config:

```json
{
  "mcpServers": {
    "pushengage": {
      "command": "/absolute/path/from/which-npx",
      "args": ["-y", "@pushengage/mcp"],
      "env": {
        "PATH": "/absolute/folder/containing/that/npx:/usr/bin:/bin:/usr/sbin:/sbin"
      }
    }
  }
}
```

Restart the client after editing. If `which npx` instead prints something under `/usr/local/bin` or `/opt/homebrew/bin`, your Node install isn't version-manager-based and this likely isn't your issue — check the client's own MCP logs for the actual error instead.

### Other errors

- **`AUTH_EXPIRED`** — your token expired. Ask the assistant to log you in again.
- **`NO_SITE_SELECTED`** — call `pushengage_list_sites` and then ask to use one of the returned sites before using a site-scoped tool.
- **Browser doesn't open** — this happens in headless or remote (e.g. SSH) sessions. The authorize URL is printed to the terminal running the server; open it manually.
- **Something else** — every error the server returns starts with a `[CODE]` tag and a plain-language explanation; share that with support if you need help.

## License

[MIT](./LICENSE)
