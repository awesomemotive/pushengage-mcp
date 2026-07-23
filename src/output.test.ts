// src/output.test.ts
import {
  AttributesListOutput,
  CreateAudienceGroupOutput,
  SendNotificationOutput,
  SiteDetailsOutput,
} from './output';

describe('output schemas (lenient)', () => {
  // The point of the lenient schemas is that the SDK's runtime structuredContent validation can
  // never reject a real response. Verify a representative set accepts the empty object, a fully
  // populated payload, and an object carrying unexpected extra keys.
  const schemas = [
    { name: 'SiteDetailsOutput', schema: SiteDetailsOutput },
    { name: 'AttributesListOutput', schema: AttributesListOutput },
    { name: 'CreateAudienceGroupOutput', schema: CreateAudienceGroupOutput },
    { name: 'SendNotificationOutput', schema: SendNotificationOutput },
  ];

  for (const { name, schema } of schemas) {
    it(`${name} accepts empty, full, and extra-key objects`, () => {
      expect(schema.safeParse({}).success).toBe(true);
      expect(schema.safeParse({ totally: 'unexpected', nested: { a: 1 } }).success).toBe(true);
    });
  }

  it('preserves unknown keys via passthrough (structured output is not stripped)', () => {
    const parsed = SiteDetailsOutput.parse({ site_id: 1, custom_future_field: 'kept' });
    expect(parsed).toMatchObject({ site_id: 1, custom_future_field: 'kept' });
  });
});
