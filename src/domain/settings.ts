import { z } from "zod";
import { EVENT_TYPES, type EventType, type ShopSettings } from "./types.js";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const eventList = z.array(z.enum(EVENT_TYPES)).transform((events) => uniqueEvents(events));

const templateText = z.string().trim().min(1).max(1000);
const shortText = z.string().trim().min(1).max(320);

export const settingsSchema = z.object({
  smsEvents: eventList,
  voiceEvents: eventList,
  templates: z.object({
    order_paid: templateText,
    order_shipped: templateText,
    order_delivered: templateText,
    order_cancelled: templateText,
    order_refunded: templateText,
    order_stalled: templateText,
  }),
  quietHoursEnabled: z.boolean(),
  quietHoursStart: z.string().regex(TIME, "Use 24-hour HH:MM"),
  quietHoursEnd: z.string().regex(TIME, "Use 24-hour HH:MM"),
  quietHoursTimezone: z
    .string()
    .refine(isTimeZone, "Use an IANA time zone such as America/New_York"),
  stalledAfterDays: z.number().int().min(1).max(30),
  optOutMessage: shortText,
  helpMessage: shortText,
  statusTemplate: shortText,
});

export function defaultSettings(timezone = "America/New_York"): ShopSettings {
  return {
    smsEvents: [...EVENT_TYPES],
    voiceEvents: [],
    templates: {
      order_paid:
        "Hi {{customer_first_name}}, we received {{order_name}} ({{order_total}}). We will text you when it ships.",
      order_shipped:
        "Hi {{customer_first_name}}, {{order_name}} is on the way via {{tracking_company}}. Tracking {{tracking_number}} {{tracking_url}}",
      order_delivered:
        "Hi {{customer_first_name}}, {{order_name}} was delivered. Reply STATUS any time for an update.",
      order_cancelled:
        "Hi {{customer_first_name}}, {{order_name}} was cancelled. Reply HELP if you need a hand.",
      order_refunded: "Hi {{customer_first_name}}, a refund was issued for {{order_name}}.",
      order_stalled:
        "Hi {{customer_first_name}}, {{order_name}} is still being prepared. We will text you as soon as it ships.",
    },
    quietHoursEnabled: true,
    quietHoursStart: "21:00",
    quietHoursEnd: "08:00",
    quietHoursTimezone: timezone,
    stalledAfterDays: 3,
    optOutMessage: "You are unsubscribed from order texts. Reply START to opt back in.",
    helpMessage:
      "Order Alerts sends SMS updates about your order. Reply STATUS for the latest update, STOP to unsubscribe, or START to resubscribe.",
    statusTemplate: "{{order_name}} is {{status_summary}}.",
  };
}

export function parseSettings(input: unknown): ShopSettings {
  return settingsSchema.parse(input);
}

export function settingsError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "settings"}: ${issue.message}`)
      .join("; ");
  }
  return "Settings are invalid";
}

export function isTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function uniqueEvents(events: EventType[]): EventType[] {
  return EVENT_TYPES.filter((event) => events.includes(event));
}
