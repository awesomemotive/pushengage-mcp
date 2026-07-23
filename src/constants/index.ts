// src/constants/index.ts
//
// Static, hand-maintained constants for the MCP server. (Unlike src/version.ts, which is
// auto-generated from package.json, this file is committed and edited by hand.)

/**
 * Client identifier sent to the PushEngage API in the `X-PE-Client` header so API-side logging
 * and `auth.client` can attribute requests to the MCP (vs dashboard / zapier / etc.). This is a
 * self-declared header — fine for attribution/telemetry, not a security signal.
 */
export const PE_CLIENT = 'mcp';
