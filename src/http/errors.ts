// src/http/errors.ts
import { ZodError } from 'zod';

export type ErrorCode =
  | 'AUTH_EXPIRED'
  | 'AUTH_DENIED'
  | 'AUTH_STATE_MISMATCH'
  | 'NO_SITE_SELECTED'
  | 'VALIDATION'
  | 'FORBIDDEN'
  | 'CONFIG_CORRUPT'
  | 'API_ERROR';

export class McpServerError extends Error {
  public readonly code: ErrorCode;
  public readonly hint?: string;

  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.name = code;
  }

  render(): string {
    const base = `[${this.code}] ${this.message}`;
    return this.hint ? `${base}\nhint: ${this.hint}` : base;
  }
}

export class AuthExpiredError extends McpServerError {
  constructor(message = 'Token expired or invalid') {
    super('AUTH_EXPIRED', message, 'call pushengage_auth_login to re-authenticate');
  }
}

export class AuthDeniedError extends McpServerError {
  constructor(message = 'User denied authorization') {
    super('AUTH_DENIED', message, 'try pushengage_auth_login again and click Authorize');
  }
}

export class AuthStateMismatchError extends McpServerError {
  constructor(message = 'State nonce mismatch in auth callback') {
    super('AUTH_STATE_MISMATCH', message, 'try pushengage_auth_login again');
  }
}

export class NoSiteSelectedError extends McpServerError {
  constructor(message = 'No site selected and no site_id provided') {
    super('NO_SITE_SELECTED', message, 'call pushengage_list_sites then pushengage_select_site');
  }
}

export class ForbiddenError extends McpServerError {
  constructor(message: string) {
    super('FORBIDDEN', message);
  }
}

export class ConfigCorruptError extends McpServerError {
  constructor(path: string) {
    super(
      'CONFIG_CORRUPT',
      `Config file at ${path} is corrupt or unreadable`,
      'delete the file and run pushengage_auth_login again',
    );
  }
}

export class ValidationError extends McpServerError {
  public readonly fieldErrors: Record<string, string>;
  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    const summary =
      Object.keys(fieldErrors).length > 0
        ? `${message}\n${Object.entries(fieldErrors)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n')}`
        : message;
    super('VALIDATION', summary);
    this.fieldErrors = fieldErrors;
  }
}

export class ApiError extends McpServerError {
  public readonly status: number;
  constructor(status: number, message: string) {
    super('API_ERROR', message);
    this.status = status;
  }
}

/** Adonis API envelope: `{ status, error: { message, details: [{ path, message }] } }`. */
function extractApiError(body: unknown): { message: string; fieldErrors: Record<string, string> } {
  const root = (body ?? {}) as Record<string, unknown>;
  const nested = (root.error ?? root) as Record<string, unknown>;
  const message =
    typeof nested.message === 'string'
      ? nested.message
      : typeof root.message === 'string'
        ? root.message
        : 'Request failed';

  const fieldErrors: Record<string, string> = {};
  const details = nested.details ?? root.errors;

  if (Array.isArray(details)) {
    for (const item of details) {
      const detail = item as Record<string, unknown>;
      const path = Array.isArray(detail.path)
        ? detail.path.join('.')
        : typeof detail.path === 'string'
          ? detail.path
          : typeof detail.context === 'object' &&
              detail.context !== null &&
              'key' in (detail.context as Record<string, unknown>)
            ? String((detail.context as Record<string, unknown>).key)
            : 'unknown';
      const detailMessage = typeof detail.message === 'string' ? detail.message : message;
      fieldErrors[path] = detailMessage;
    }
  } else if (details && typeof details === 'object') {
    Object.assign(fieldErrors, details as Record<string, string>);
  }

  return { message, fieldErrors };
}

export function mapHttpError(status: number, body: unknown): McpServerError {
  const { message, fieldErrors } = extractApiError(body);

  if (status === 401) return new AuthExpiredError(message);
  if (status === 403) return new ForbiddenError(message);
  if ((status === 400 || status === 422) && Object.keys(fieldErrors).length > 0) {
    return new ValidationError(message, fieldErrors);
  }
  return new ApiError(status, message);
}

/**
 * Flatten a ZodError into `path: message` pairs.
 *
 * Deepest-first wins per path is not needed — Zod already reports one issue per path in practice,
 * and a later issue on the same path is the more specific one (a superRefine runs after the base
 * shape check), so a plain overwrite is right.
 */
function zodFieldErrors(err: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(input)';
    fieldErrors[path] = issue.message;
  }
  return fieldErrors;
}

/**
 * Render any thrown value as an MCP tool error result. A typed McpServerError renders with its
 * code + hint; anything else degrades to a generic [API_ERROR]. Shared by every tool handler's
 * catch block, so it lives here alongside the error types rather than in any one tool module.
 *
 * A ZodError is translated rather than stringified. Every tool handler re-parses its input with
 * the full schema (the SDK only introspects the plain object shape, so cross-field refinements
 * run here), which means a mutually-exclusive-mode or bad-enum error arrives as a ZodError even
 * though no request was ever made. Left to the generic branch it rendered as `[API_ERROR]`
 * followed by Zod's raw JSON dump: a wrong code for a client-side refusal, and unreadable for the
 * model that has to correct it. Reported as P3-1 in QA on PR #287.
 */
export function errorResult(err: unknown) {
  if (err instanceof McpServerError) {
    return { content: [{ type: 'text' as const, text: err.render() }], isError: true };
  }
  if (err instanceof ZodError) {
    const validation = new ValidationError(
      "The request did not match this tool's input schema, so nothing was sent.",
      zodFieldErrors(err),
    );
    return { content: [{ type: 'text' as const, text: validation.render() }], isError: true };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text' as const, text: `[API_ERROR] ${msg}` }],
    isError: true,
  };
}
