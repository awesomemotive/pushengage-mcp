// src/sites/schema.test.ts
import { ValidationError } from '../http/errors';
import {
  type SiteDetails,
  UpdateSiteDetailsInputSchema,
  buildSiteDetailsUpdateBody,
  toSiteDetails,
} from './schema';

const RAW = {
  site_id: 30,
  site_name: 'Acme Store',
  site_url: 'https://acme.example.com',
  site_image: 'https://cdn.example.com/icon.png',
  is_whitelabel: 1,
  settings: {
    timezone: { value: 'America/New_York' },
    privacy_settings: { geoLocationEnabled: true },
  },
};

const CURRENT: SiteDetails = toSiteDetails(RAW);

describe('toSiteDetails', () => {
  it('maps API fields to dashboard-labelled fields', () => {
    expect(CURRENT).toEqual({
      site_id: 30,
      site_name: 'Acme Store',
      site_url: 'https://acme.example.com',
      site_image: 'https://cdn.example.com/icon.png',
      timezone: 'America/New_York',
      enable_geolocation: true,
      remove_powered_by_pushengage: true,
    });
  });

  it('treats is_whitelabel !== 1 as not removed, and missing geo as false', () => {
    const d = toSiteDetails({ site_id: 5, is_whitelabel: 0, settings: {} });
    expect(d.remove_powered_by_pushengage).toBe(false);
    expect(d.enable_geolocation).toBe(false);
    expect(d.timezone).toBe('');
  });

  it('degrades gracefully on an empty body', () => {
    expect(toSiteDetails({})).toEqual({
      site_id: undefined,
      site_name: '',
      site_url: '',
      site_image: '',
      timezone: '',
      enable_geolocation: false,
      remove_powered_by_pushengage: false,
    });
  });
});

describe('UpdateSiteDetailsInputSchema', () => {
  it('enforces site_name length and accepts a single field', () => {
    expect(UpdateSiteDetailsInputSchema.safeParse({ site_name: 'ab' }).success).toBe(false); // < 3
    expect(UpdateSiteDetailsInputSchema.safeParse({ site_name: 'a'.repeat(151) }).success).toBe(
      false,
    );
    expect(UpdateSiteDetailsInputSchema.safeParse({ enable_geolocation: true }).success).toBe(true);
  });

  it('rejects a site_url over 400 chars', () => {
    expect(
      UpdateSiteDetailsInputSchema.safeParse({ site_url: `https://x.com/${'a'.repeat(400)}` })
        .success,
    ).toBe(false);
  });
});

describe('buildSiteDetailsUpdateBody', () => {
  it('sends only the provided top-level field', () => {
    const { body, result } = buildSiteDetailsUpdateBody({ site_name: 'New Name' }, CURRENT);
    expect(body).toEqual({ site_name: 'New Name' });
    expect(result.site_name).toBe('New Name');
    expect(result.timezone).toBe('America/New_York'); // unchanged in echo
  });

  it('maps timezone + geolocation into the settings sub-object', () => {
    const { body } = buildSiteDetailsUpdateBody(
      { timezone: 'Asia/Kolkata', enable_geolocation: false },
      CURRENT,
    );
    expect(body.settings).toEqual({
      timezone: { value: 'Asia/Kolkata' },
      privacy_settings: { geoLocationEnabled: false },
    });
  });

  it('pads the current site_name on a settings-only update (API requires a top-level field)', () => {
    const tz = buildSiteDetailsUpdateBody({ timezone: 'Asia/Kolkata' }, CURRENT);
    expect(tz.body).toEqual({
      settings: { timezone: { value: 'Asia/Kolkata' } },
      site_name: 'Acme Store',
    });
    expect(tz.result.site_name).toBe('Acme Store'); // echo unchanged by the no-op pad
    expect(tz.result.timezone).toBe('Asia/Kolkata');

    // geolocation-only update is also settings-only, so it gets padded too
    const geo = buildSiteDetailsUpdateBody({ enable_geolocation: true }, CURRENT);
    expect(geo.body.site_name).toBe('Acme Store');
  });

  it('does not pad when a top-level field is already present', () => {
    const { body } = buildSiteDetailsUpdateBody(
      { timezone: 'Asia/Kolkata', site_url: 'https://new.example.com' },
      CURRENT,
    );
    expect(body.site_name).toBeUndefined();
    expect(body.site_url).toBe('https://new.example.com');
  });

  it('skips padding when the current site_name is empty (cannot safely no-op)', () => {
    const { body } = buildSiteDetailsUpdateBody(
      { timezone: 'Asia/Kolkata' },
      { ...CURRENT, site_name: '' },
    );
    expect(body.site_name).toBeUndefined();
  });

  it('maps remove_powered_by_pushengage to is_whitelabel 0/1', () => {
    expect(
      buildSiteDetailsUpdateBody({ remove_powered_by_pushengage: true }, CURRENT).body,
    ).toEqual({ is_whitelabel: 1 });
    expect(
      buildSiteDetailsUpdateBody({ remove_powered_by_pushengage: false }, CURRENT).body,
    ).toEqual({ is_whitelabel: 0 });
  });

  it('throws when no field is provided', () => {
    expect(() => buildSiteDetailsUpdateBody({}, CURRENT)).toThrow(ValidationError);
  });
});
