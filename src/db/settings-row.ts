import { defaultSettings, parseSettings } from "../domain/settings.js";
import type { ShopSettings } from "../domain/types.js";

export interface SettingsRow {
  smsEvents: string;
  voiceEvents: string;
  templates: string;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursTimezone: string;
  stalledAfterDays: number;
  optOutMessage: string;
  helpMessage: string;
  statusTemplate: string;
}

export function settingsToRow(settings: ShopSettings): SettingsRow {
  return {
    smsEvents: JSON.stringify(settings.smsEvents),
    voiceEvents: JSON.stringify(settings.voiceEvents),
    templates: JSON.stringify(settings.templates),
    quietHoursEnabled: settings.quietHoursEnabled,
    quietHoursStart: settings.quietHoursStart,
    quietHoursEnd: settings.quietHoursEnd,
    quietHoursTimezone: settings.quietHoursTimezone,
    stalledAfterDays: settings.stalledAfterDays,
    optOutMessage: settings.optOutMessage,
    helpMessage: settings.helpMessage,
    statusTemplate: settings.statusTemplate,
  };
}

export function settingsFromRow(row: SettingsRow, timezone: string): ShopSettings {
  try {
    return parseSettings({
      smsEvents: JSON.parse(row.smsEvents) as unknown,
      voiceEvents: JSON.parse(row.voiceEvents) as unknown,
      templates: JSON.parse(row.templates) as unknown,
      quietHoursEnabled: row.quietHoursEnabled,
      quietHoursStart: row.quietHoursStart,
      quietHoursEnd: row.quietHoursEnd,
      quietHoursTimezone: row.quietHoursTimezone,
      stalledAfterDays: row.stalledAfterDays,
      optOutMessage: row.optOutMessage,
      helpMessage: row.helpMessage,
      statusTemplate: row.statusTemplate,
    });
  } catch {
    return defaultSettings(timezone);
  }
}
