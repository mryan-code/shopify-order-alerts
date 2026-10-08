export const EVENT_TYPES = [
  "order_paid",
  "order_shipped",
  "order_delivered",
  "order_cancelled",
  "order_refunded",
  "order_stalled",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const TEMPLATE_VARIABLES = [
  "customer_first_name",
  "customer_name",
  "order_name",
  "order_total",
  "tracking_number",
  "tracking_url",
  "tracking_company",
  "shop_name",
  "order_status_url",
  "status_summary",
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export type TemplateContext = Partial<Record<TemplateVariable, string | null>>;

export interface ShopSettings {
  smsEvents: EventType[];
  voiceEvents: EventType[];
  templates: Record<EventType, string>;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursTimezone: string;
  stalledAfterDays: number;
  optOutMessage: string;
  helpMessage: string;
  statusTemplate: string;
}

export const EVENT_LABELS: Record<EventType, string> = {
  order_paid: "Order paid",
  order_shipped: "Order shipped",
  order_delivered: "Order delivered",
  order_cancelled: "Order cancelled",
  order_refunded: "Order refunded",
  order_stalled: "Order stalled",
};
