// src/http/errors.test.ts
import {
  ApiError,
  AuthExpiredError,
  ForbiddenError,
  ValidationError,
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
