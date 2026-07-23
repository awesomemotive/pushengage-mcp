// src/attributes/schema.test.ts
import {
  CreateAttributeInputSchema,
  ListAttributesInputSchema,
  toCreateAttributeApiBody,
} from './schema';

describe('ListAttributesInputSchema', () => {
  it('applies defaults (limit=10, page=1)', () => {
    const result = ListAttributesInputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.page).toBe(1);
    }
  });

  it('accepts limit up to 100', () => {
    expect(ListAttributesInputSchema.safeParse({ limit: 100 }).success).toBe(true);
  });

  it('rejects limit > 100', () => {
    expect(ListAttributesInputSchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it('rejects page < 1', () => {
    expect(ListAttributesInputSchema.safeParse({ page: 0 }).success).toBe(false);
  });

  it('accepts key_contains substring filter', () => {
    expect(ListAttributesInputSchema.safeParse({ key_contains: 'plan' }).success).toBe(true);
  });

  it('rejects whitespace-only key_contains', () => {
    expect(ListAttributesInputSchema.safeParse({ key_contains: '   ' }).success).toBe(false);
  });
});

describe('CreateAttributeInputSchema', () => {
  it('accepts a minimal valid create', () => {
    const result = CreateAttributeInputSchema.safeParse({
      name: 'Customer Plan',
      key: 'plan',
    });
    expect(result.success).toBe(true);
  });

  it('accepts keys with letters, digits, hyphens, and underscores', () => {
    const result = CreateAttributeInputSchema.safeParse({
      name: 'Signup',
      key: 'signup_source-2',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = CreateAttributeInputSchema.safeParse({ name: '  ', key: 'plan' });
    expect(result.success).toBe(false);
  });

  it('rejects name > 128 chars', () => {
    const result = CreateAttributeInputSchema.safeParse({
      name: 'x'.repeat(129),
      key: 'plan',
    });
    expect(result.success).toBe(false);
  });

  it('rejects key > 64 chars', () => {
    const result = CreateAttributeInputSchema.safeParse({
      name: 'X',
      key: 'a'.repeat(65),
    });
    expect(result.success).toBe(false);
  });

  it('rejects key starting with a digit', () => {
    const result = CreateAttributeInputSchema.safeParse({ name: 'X', key: '1plan' });
    expect(result.success).toBe(false);
  });

  it('rejects key starting with a hyphen', () => {
    const result = CreateAttributeInputSchema.safeParse({ name: 'X', key: '-plan' });
    expect(result.success).toBe(false);
  });

  it('rejects key with spaces', () => {
    const result = CreateAttributeInputSchema.safeParse({ name: 'X', key: 'my plan' });
    expect(result.success).toBe(false);
  });

  it('rejects key with special chars', () => {
    const result = CreateAttributeInputSchema.safeParse({ name: 'X', key: 'plan@v2' });
    expect(result.success).toBe(false);
  });

  it('accepts single-letter key', () => {
    const result = CreateAttributeInputSchema.safeParse({ name: 'X', key: 'x' });
    expect(result.success).toBe(true);
  });
});

describe('toCreateAttributeApiBody', () => {
  it('forwards name and key verbatim', () => {
    const body = toCreateAttributeApiBody({ name: 'Customer Plan', key: 'plan' });
    expect(body).toEqual({ name: 'Customer Plan', key: 'plan' });
  });

  it('does not include site_id in the API body (that comes via the URL path)', () => {
    const body = toCreateAttributeApiBody({
      name: 'Customer Plan',
      key: 'plan',
      site_id: 999,
    });
    expect(body).toEqual({ name: 'Customer Plan', key: 'plan' });
  });
});
