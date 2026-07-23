// src/chatWidgets/labels.test.ts
import {
  channelTypeLabel,
  chatWidgetStatusFilterCode,
  chatWidgetStatusLabel,
  deviceLabel,
} from './labels';

describe('channelTypeLabel', () => {
  it('maps known channel types', () => {
    expect(channelTypeLabel('whatsapp')).toBe('WhatsApp');
    expect(channelTypeLabel('messenger')).toBe('Messenger');
    expect(channelTypeLabel('instagram_dm')).toBe('Instagram DM');
    expect(channelTypeLabel('twitter')).toBe('X (Twitter)');
    expect(channelTypeLabel('custom')).toBe('Custom Link');
  });
  it('humanizes unknown types', () => {
    expect(channelTypeLabel('some_new_channel')).toBe('Some New Channel');
  });
});

describe('deviceLabel', () => {
  it('maps the three devices', () => {
    expect(deviceLabel('desktop')).toBe('Desktop');
    expect(deviceLabel('mobile')).toBe('Mobile');
    expect(deviceLabel('tablet')).toBe('Tablet');
  });
});

describe('chatWidgetStatusLabel', () => {
  it('enabled->Active, disabled->Inactive', () => {
    expect(chatWidgetStatusLabel('enabled')).toBe('Active');
    expect(chatWidgetStatusLabel('disabled')).toBe('Inactive');
  });
});

describe('chatWidgetStatusFilterCode (friendly -> raw API code)', () => {
  it('maps active/inactive and omits "all"', () => {
    expect(chatWidgetStatusFilterCode('active')).toBe('enabled');
    expect(chatWidgetStatusFilterCode('inactive')).toBe('disabled');
    expect(chatWidgetStatusFilterCode('all')).toBeUndefined();
  });
});
