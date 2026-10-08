import { DateTime } from "luxon";

export interface QuietHours {
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursTimezone: string;
}

export function nextSendTime(now: Date, settings: QuietHours): Date {
  if (!settings.quietHoursEnabled) return now;
  const start = minutes(settings.quietHoursStart);
  const end = minutes(settings.quietHoursEnd);
  if (start === null || end === null || start === end) return now;

  const local = DateTime.fromJSDate(now, { zone: settings.quietHoursTimezone });
  if (!local.isValid) return now;

  const nowMinutes = local.hour * 60 + local.minute;
  const crossesMidnight = start > end;
  const inQuiet = crossesMidnight
    ? nowMinutes >= start || nowMinutes < end
    : nowMinutes >= start && nowMinutes < end;
  if (!inQuiet) return now;

  const endHour = Math.floor(end / 60);
  const endMinute = end % 60;
  let resume = local.set({ hour: endHour, minute: endMinute, second: 0, millisecond: 0 });
  if (crossesMidnight && nowMinutes >= start) resume = resume.plus({ days: 1 });
  return resume.toJSDate();
}

function minutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match?.[1] || !match[2]) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}
