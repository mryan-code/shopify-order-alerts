export const EVENT_TYPES = [
  "order_paid",
  "order_shipped",
  "order_delivered",
  "order_cancelled",
  "order_refunded",
  "order_stalled",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_LABELS: Record<EventType, string> = {
  order_paid: "Order paid",
  order_shipped: "Order shipped",
  order_delivered: "Order delivered",
  order_cancelled: "Order cancelled",
  order_refunded: "Order refunded",
  order_stalled: "Order stalled",
};

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
];

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

export interface Conversation {
  shopifyOrderId: string;
  orderName: string;
  customerFirstName: string | null;
  customerPhone: string | null;
  statusSummary: string | null;
  updatedAt: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastDirection: "inbound" | "outbound" | null;
}

export interface ThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  channel: "sms" | "voice";
  body: string;
  status: string;
  eventType: string | null;
  createdAt: string;
}

export interface OrderDetails {
  shopifyOrderId: string;
  orderName: string;
  customerFirstName: string | null;
  customerPhone: string | null;
  statusSummary: string;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  trackingCompany: string | null;
}
