// src/siteSettings/schema.test.ts
import { ValidationError } from '../http/errors';
import {
  type CampaignDefaults,
  type ServiceWorkerSettings,
  UpdateCampaignDefaultsInputSchema,
  UpdateServiceWorkerSettingsInputSchema,
  buildServiceWorkerUpdateBody,
  buildUpdateBody,
  secondsToBreakdown,
  toCampaignDefaults,
  toServiceWorkerSettings,
} from './schema';

const RAW = {
  utm_settings: {
    enabled: true,
    utm_source: 'pushengage',
    utm_medium: 'push',
    utm_campaign: 'broadcast',
    utm_term: '',
    utm_content: '',
  },
  default_notification: {
    default_notification_title: 'We miss you',
    default_notification_message: 'Come back for 20% off',
    default_notification_url: 'https://example.com',
  },
  default_custom_params: { custom_city: 'Austin', custom_country: 'US' },
  default_notification_expiry: { value: 2419200 },
};

const CURRENT: CampaignDefaults = toCampaignDefaults(RAW);

describe('secondsToBreakdown', () => {
  it('splits seconds into days/hours/minutes', () => {
    expect(secondsToBreakdown(604800)).toEqual({
      total_seconds: 604800,
      days: 7,
      hours: 0,
      minutes: 0,
    });
    expect(secondsToBreakdown(90000)).toEqual({
      total_seconds: 90000,
      days: 1,
      hours: 1,
      minutes: 0,
    });
  });
});

describe('toCampaignDefaults', () => {
  it('maps API field names to the MCP view', () => {
    expect(CURRENT).toEqual({
      utm_parameters: {
        enabled: true,
        source: 'pushengage',
        medium: 'push',
        campaign: 'broadcast',
        term: '',
        content: '',
      },
      fallback_notification: {
        title: 'We miss you',
        message: 'Come back for 20% off',
        url: 'https://example.com',
      },
      fallback_attributes: { city: 'Austin', country: 'US' },
      default_expiry: { total_seconds: 2419200, days: 28, hours: 0, minutes: 0 },
    });
  });

  it('degrades gracefully on an empty body (enabled defaults true)', () => {
    const d = toCampaignDefaults({});
    expect(d.utm_parameters.enabled).toBe(true);
    expect(d.fallback_notification.title).toBe('');
    expect(d.default_expiry.total_seconds).toBe(0);
  });
});

describe('UpdateCampaignDefaultsInputSchema', () => {
  it('accepts a partial update and enforces field max lengths', () => {
    expect(
      UpdateCampaignDefaultsInputSchema.safeParse({ utm_parameters: { source: 'x' } }).success,
    ).toBe(true);
    expect(
      UpdateCampaignDefaultsInputSchema.safeParse({ utm_parameters: { source: 'a'.repeat(81) } })
        .success,
    ).toBe(false);
    expect(
      UpdateCampaignDefaultsInputSchema.safeParse({ default_expiry: { days: 29 } }).success,
    ).toBe(false);
  });
});

describe('buildUpdateBody', () => {
  it('merges a single utm field and emits only the touched group', () => {
    const { body, result } = buildUpdateBody({ utm_parameters: { source: 'newsletter' } }, CURRENT);
    expect(body).toEqual({
      utm_settings: {
        enabled: true,
        utm_source: 'newsletter',
        utm_medium: 'push',
        utm_campaign: 'broadcast',
      },
    });
    expect(body.default_notification).toBeUndefined();
    expect(result.utm_parameters.source).toBe('newsletter');
    expect(result.utm_parameters.medium).toBe('push');
  });

  it('computes expiry seconds from days/hours/minutes', () => {
    const { body, result } = buildUpdateBody({ default_expiry: { days: 7 } }, CURRENT);
    expect(body.default_notification_expiry).toEqual({ value: 604800 });
    expect(result.default_expiry).toEqual({
      total_seconds: 604800,
      days: 7,
      hours: 0,
      minutes: 0,
    });
  });

  it('merges fallback_notification (omitted fields kept from current)', () => {
    const { body } = buildUpdateBody({ fallback_notification: { title: 'New title' } }, CURRENT);
    expect(body.default_notification).toEqual({
      default_notification_title: 'New title',
      default_notification_message: 'Come back for 20% off',
      default_notification_url: 'https://example.com',
    });
  });

  it('throws when no group is provided', () => {
    expect(() => buildUpdateBody({}, CURRENT)).toThrow(ValidationError);
  });

  it('throws when expiry is out of range', () => {
    expect(() => buildUpdateBody({ default_expiry: { minutes: 0 } }, CURRENT)).toThrow(
      /1 minute and 28 days/,
    );
  });

  it('throws when enabling UTM without required fields after merge', () => {
    const blank = toCampaignDefaults({ utm_settings: { enabled: false } });
    expect(() => buildUpdateBody({ utm_parameters: { enabled: true } }, blank)).toThrow(
      ValidationError,
    );
  });

  it('keeps utm_term/utm_content out of the body when empty', () => {
    const { body } = buildUpdateBody({ utm_parameters: { medium: 'email' } }, CURRENT);
    expect(body.utm_settings).not.toHaveProperty('utm_term');
    expect(body.utm_settings).not.toHaveProperty('utm_content');
  });
});

const SW_CURRENT: ServiceWorkerSettings = toServiceWorkerSettings({
  service_worker: { workerStatus: true, scope: true, worker: 'https://x.com/sw.js' },
});

describe('toServiceWorkerSettings', () => {
  it('maps fields to dashboard labels and inverts scope into the sub-folder flag', () => {
    expect(SW_CURRENT).toEqual({
      enable_service_worker_registration: true,
      enable_service_worker_in_subfolder: false, // scope:true -> subfolder disabled
      service_worker_file_path: 'https://x.com/sw.js',
    });
    expect(
      toServiceWorkerSettings({
        service_worker: { workerStatus: false, scope: false, worker: '' },
      }),
    ).toEqual({
      enable_service_worker_registration: false,
      enable_service_worker_in_subfolder: true, // scope:false -> subfolder enabled
      service_worker_file_path: '',
    });
  });

  it('defaults registration to true and sub-folder to false on empty body', () => {
    expect(toServiceWorkerSettings({})).toEqual({
      enable_service_worker_registration: true,
      enable_service_worker_in_subfolder: false,
      service_worker_file_path: '',
    });
  });
});

describe('UpdateServiceWorkerSettingsInputSchema', () => {
  it('enforces service_worker_file_path max length', () => {
    expect(
      UpdateServiceWorkerSettingsInputSchema.safeParse({
        service_worker_file_path: 'a'.repeat(501),
      }).success,
    ).toBe(false);
    expect(
      UpdateServiceWorkerSettingsInputSchema.safeParse({
        enable_service_worker_registration: false,
      }).success,
    ).toBe(true);
  });
});

describe('buildServiceWorkerUpdateBody', () => {
  it('merges a single field and inverts the sub-folder flag back into scope', () => {
    const { body, result } = buildServiceWorkerUpdateBody(
      { enable_service_worker_in_subfolder: true },
      SW_CURRENT,
    );
    expect(body).toEqual({
      service_worker: { workerStatus: true, scope: false, worker: 'https://x.com/sw.js' },
    });
    expect(result.enable_service_worker_in_subfolder).toBe(true);
    expect(result.service_worker_file_path).toBe('https://x.com/sw.js');
  });

  it('throws when no field is provided', () => {
    expect(() => buildServiceWorkerUpdateBody({}, SW_CURRENT)).toThrow(ValidationError);
  });

  it('throws when enabling registration without a file path after merge', () => {
    const blank = toServiceWorkerSettings({
      service_worker: { workerStatus: false, scope: true, worker: '' },
    });
    expect(() =>
      buildServiceWorkerUpdateBody({ enable_service_worker_registration: true }, blank),
    ).toThrow(/service_worker_file_path/);
  });

  it('allows disabling registration even with an empty file path', () => {
    const blank = toServiceWorkerSettings({
      service_worker: { workerStatus: true, scope: true, worker: '' },
    });
    const { body } = buildServiceWorkerUpdateBody(
      { enable_service_worker_registration: false },
      blank,
    );
    expect(body.service_worker.workerStatus).toBe(false);
  });
});
