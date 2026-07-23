# Security Policy

## Supported versions

Only the latest published version of `@pushengage/mcp` receives security fixes. Please update to the newest release before reporting.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Report them privately via GitHub's vulnerability reporting: go to this repository's **Security** tab and click **Report a vulnerability**. Include the affected version, reproduction steps, and impact.

We will acknowledge your report, keep you informed of progress, and credit you in the fix's release notes unless you prefer otherwise.

## Scope notes

- This package stores an access token at `~/.pushengage/mcp.json` with `0600` permissions and receives it over a loopback-only HTTP callback. Reports about weaknesses in that flow are in scope.
- Vulnerabilities in the PushEngage platform itself (dashboard, API, SDKs) rather than this MCP server should go to [PushEngage support](https://www.pushengage.com/) instead.
