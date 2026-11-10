// src/http/errors.test.ts
import { z } from 'zod';

import {
  ApiError,
  AuthExpiredError,
  ForbiddenError,
  ValidationError,
  errorResult,
  mapHttpError,
} from './errors';

describe('mapHttpError', () => {
  it('maps 401 to AuthExpiredError', () => {
    const err = mapHttpError(401, { message: 'Token expired' });
    expect(err).toBeInstanceOf(AuthExpiredError);
    expect(err.code).toBe('AUTH_EXPIRED');
  });

  it('maps 403 to ForbiddenError carrying message', () => {
    const err = mapHttpError(403, { message: 'Plan expired' });
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).toContain('Plan expired');
  });

  it('maps 422 to ValidationError carrying errors map', () => {
    const err = mapHttpError(422, { errors: { url: 'Invalid URL' } });
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.code).toBe('VALIDATION');
    expect((err as ValidationError).fieldErrors).toEqual({ url: 'Invalid URL' });
  });

  it('maps 400 Adonis validation details to ValidationError', () => {
    const err = mapHttpError(400, {
      status: 400,
      error: {
        name: 'InvalidRequestException',
        message: 'Invalid request data.',
        details: [{ message: '"status" must be one of [sent, scheduled]', path: ['status'] }],
      },
    });
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.code).toBe('VALIDATION');
    expect((err as ValidationError).fieldErrors).toEqual({
      status: '"status" must be one of [sent, scheduled]',
    });
  });

  it('maps other 4xx/5xx to ApiError', () => {
    const err = mapHttpError(500, { message: 'Server error' });
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('API_ERROR');
  });
});

describe('error rendering', () => {
  it('AuthExpiredError renders with hint', () => {
    const err = new AuthExpiredError('Token expired');
    expect(err.render()).toContain('[AUTH_EXPIRED]');
    expect(err.render()).toMatch(/hint:\s*call pushengage_auth_login/);
  });

  it('ValidationError renders field errors', () => {
    const err = new ValidationError('Validation failed', { url: 'Invalid URL' });
    expect(err.render()).toContain('[VALIDATION]');
    expect(err.render()).toContain('url: Invalid URL');
  });
});

describe('errorResult', () => {
  const textOf = (r: ReturnType<typeof errorResult>) => r.content[0].text;

  it('renders a typed error with its code and hint', () => {
    const r = errorResult(new AuthExpiredError('Token expired'));
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe(
      '[AUTH_EXPIRED] Token expired\nhint: call pushengage_auth_login to re-authenticate',
    );
  });

  // QA P3-1 on PR #287. Every tool handler re-parses its input with the full schema, because the
  // SDK only introspects the plain object shape and cross-field refinements have to run
  // somewhere. A refinement failure is therefore a ZodError thrown before any request is made —
  // and it used to render as `[API_ERROR]` followed by Zod's raw JSON dump.
  describe('ZodError', () => {
    const schema = z
      .object({ title: z.string().min(1), count: z.number().int() })
      .superRefine((v, ctx) => {
        if (v.title === 'both') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['title'],
            message: 'subscriber_filter and audience_groups are mutually exclusive',
          });
        }
      });

    const parseError = (input: unknown) => {
      try {
        schema.parse(input);
        throw new Error('expected a ZodError');
      } catch (err) {
        return errorResult(err);
      }
    };

    it('is reported as VALIDATION, not API_ERROR', () => {
      const text = textOf(parseError({ title: '', count: 1.5 }));
      expect(text.startsWith('[VALIDATION]')).toBe(true);
      expect(text).not.toContain('[API_ERROR]');
    });

    it('is readable prose rather than a JSON dump', () => {
      const text = textOf(parseError({ title: '', count: 1.5 }));
      expect(text).toContain('title: ');
      expect(text).toContain('count: ');
      // Zod's own message is the serialized issue array; none of that should survive.
      expect(text).not.toContain('"code"');
      expect(text).not.toContain('[\n');
    });

    it('carries a refinement message through verbatim', () => {
      expect(textOf(parseError({ title: 'both', count: 1 }))).toContain(
        'subscriber_filter and audience_groups are mutually exclusive',
      );
    });

    it('labels a whole-input failure rather than printing an empty path', () => {
      const text = textOf(parseError('not an object'));
      expect(text).toContain('(input): ');
    });

    it('says nothing was sent, because nothing was', () => {
      expect(textOf(parseError({ title: '', count: 1 }))).toContain('nothing was sent');
    });
  });

  it('falls back to API_ERROR for anything untyped', () => {
    expect(textOf(errorResult(new Error('socket hang up')))).toBe('[API_ERROR] socket hang up');
    expect(textOf(errorResult('plain string'))).toBe('[API_ERROR] plain string');
  });
});
