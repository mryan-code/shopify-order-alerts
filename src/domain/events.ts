import { normalizeOrderId } from "./order-id.js";
import type { EventType, TemplateContext } from "./types.js";

export interface OrderPatch {
  shopifyOrderId: string;
  orderName?: string;
  customerFirstName?: string | null;
  customerId?: string | null;
  email?: string | null;
  customerPhone?: string | null;
  financialStatus?: string | null;
  fulfillmentStatus?: string | null;
  cancelled?: boolean;
  totalPrice?: string | null;
  currency?: string | null;
  orderStatusUrl?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  trackingCompany?: string | null;
  shopifyCreatedAt?: string | null;
}

export interface NotificationIntent {
  event: EventType;
  dedupeSuffix: string;
  patch: OrderPatch;
  context: TemplateContext;
}

export function mapWebhook(topic: string, payload: unknown): NotificationIntent[] {
  const normalized = topic.trim().toLowerCase();
  const record = asRecord(payload);
  if (!record) return [];

  switch (normalized) {
    case "orders/create":
      return mapPaidOrder(record, false);
    case "orders/paid":
      return mapPaidOrder(record, true);
    case "orders/cancelled":
      return mapCancelled(record);
    case "orders/fulfilled":
      return mapFulfilledOrder(record);
    case "fulfillments/create":
      return mapFulfillment(record, "order_shipped");
    case "fulfillments/update":
      return mapFulfillmentUpdate(record);
    case "fulfillment_events/create":
      return mapFulfillmentEvent(record);
    case "refunds/create":
      return mapRefund(record);
    default:
      return [];
  }
}

function mapPaidOrder(record: Record<string, unknown>, force: boolean): NotificationIntent[] {
  const financial = str(record, "financial_status")?.toLowerCase() ?? "";
  const paid = financial === "paid" || financial === "partially_paid";
  if (!force && !paid) return [];
  const patch = orderPatch(record);
  if (!patch) return [];
  if (!patch.financialStatus) patch.financialStatus = "paid";
  return [intent("order_paid", "paid", patch, contextFromOrder(record, patch))];
}

function mapCancelled(record: Record<string, unknown>): NotificationIntent[] {
  const patch = orderPatch(record);
  if (!patch) return [];
  patch.cancelled = true;
  return [intent("order_cancelled", "cancelled", patch, contextFromOrder(record, patch))];
}

function mapFulfilledOrder(record: Record<string, unknown>): NotificationIntent[] {
  const patch = orderPatch(record);
  if (!patch) return [];
  const fulfillments = Array.isArray(record.fulfillments) ? record.fulfillments : [];
  if (fulfillments.length === 0) {
    patch.fulfillmentStatus = patch.fulfillmentStatus ?? "fulfilled";
    return [intent("order_shipped", "order", patch, contextFromOrder(record, patch))];
  }
  return fulfillments.flatMap((entry) => {
    const fulfillment = asRecord(entry);
    if (!fulfillment) return [];
    return mapFulfillment(
      { ...fulfillment, order_id: patch.shopifyOrderId, order: record },
      "order_shipped",
    );
  });
}

function mapFulfillment(
  record: Record<string, unknown>,
  event: "order_shipped" | "order_delivered",
): NotificationIntent[] {
  const orderId = str(record, "order_id");
  if (!orderId) return [];
  const fulfillmentId = str(record, "id") ?? "order";
  const tracking = trackingFrom(record);
  const nestedOrder = asRecord(record.order);
  const destination = asRecord(record.destination);
  const patch: OrderPatch = {
    shopifyOrderId: normalizeOrderId(orderId),
    fulfillmentStatus: event === "order_delivered" ? "delivered" : "fulfilled",
    trackingNumber: tracking.number,
    trackingUrl: tracking.url,
    trackingCompany: tracking.company,
  };
  if (destination) {
    const phone = str(destination, "phone");
    const first = str(destination, "first_name");
    if (phone) patch.customerPhone = phone;
    if (first) patch.customerFirstName = first;
  }
  if (nestedOrder) {
    const order = orderPatch(nestedOrder);
    if (order?.orderName) patch.orderName = order.orderName;
    if (order?.customerPhone && !patch.customerPhone) patch.customerPhone = order.customerPhone;
    if (order?.customerFirstName && !patch.customerFirstName)
      patch.customerFirstName = order.customerFirstName;
    if (order?.orderStatusUrl) patch.orderStatusUrl = order.orderStatusUrl;
    if (order?.totalPrice) patch.totalPrice = order.totalPrice;
    if (order?.currency) patch.currency = order.currency;
  }
  const context: TemplateContext = {
    order_name: patch.orderName ?? null,
    customer_first_name: patch.customerFirstName ?? null,
    customer_name: patch.customerFirstName ?? null,
    tracking_number: tracking.number,
    tracking_url: tracking.url,
    tracking_company: tracking.company,
    order_total: formatTotal(patch.totalPrice ?? null, patch.currency ?? null),
    order_status_url: patch.orderStatusUrl ?? null,
  };
  return [intent(event, fulfillmentId, patch, context)];
}

function mapFulfillmentUpdate(record: Record<string, unknown>): NotificationIntent[] {
  const status = str(record, "shipment_status")?.toLowerCase();
  if (status !== "delivered") return [];
  return mapFulfillment(record, "order_delivered");
}

function mapFulfillmentEvent(record: Record<string, unknown>): NotificationIntent[] {
  const status = str(record, "status")?.toLowerCase();
  if (status !== "delivered") return [];
  const orderId = str(record, "order_id");
  if (!orderId) return [];
  const fulfillmentId = str(record, "fulfillment_id") ?? str(record, "id") ?? "event";
  const patch: OrderPatch = {
    shopifyOrderId: normalizeOrderId(orderId),
    fulfillmentStatus: "delivered",
  };
  return [intent("order_delivered", fulfillmentId, patch, { order_name: null })];
}

function mapRefund(record: Record<string, unknown>): NotificationIntent[] {
  const orderId = str(record, "order_id");
  const refundId = str(record, "id");
  if (!orderId || !refundId) return [];
  const patch: OrderPatch = {
    shopifyOrderId: normalizeOrderId(orderId),
    financialStatus: "refunded",
  };
  return [intent("order_refunded", refundId, patch, { order_name: null })];
}

function intent(
  event: EventType,
  dedupeSuffix: string,
  patch: OrderPatch,
  context: TemplateContext,
): NotificationIntent {
  return {
    event,
    dedupeSuffix: normalizeOrderId(dedupeSuffix),
    patch,
    context,
  };
}

function orderPatch(record: Record<string, unknown>): OrderPatch | null {
  const id = str(record, "id");
  if (!id) return null;
  const customer = asRecord(record.customer);
  const shipping = asRecord(record.shipping_address);
  const billing = asRecord(record.billing_address);
  const first =
    str(shipping ?? {}, "first_name") ??
    str(customer ?? {}, "first_name") ??
    str(billing ?? {}, "first_name");
  const phone =
    str(shipping ?? {}, "phone") ??
    str(customer ?? {}, "phone") ??
    str(record, "phone") ??
    str(billing ?? {}, "phone");
  const email = str(record, "email") ?? str(customer ?? {}, "email");
  return {
    shopifyOrderId: normalizeOrderId(id),
    orderName: str(record, "name") ?? undefined,
    customerFirstName: first,
    customerId: customer ? str(customer, "id") : null,
    email,
    customerPhone: phone,
    financialStatus: str(record, "financial_status"),
    fulfillmentStatus: str(record, "fulfillment_status"),
    cancelled: Boolean(record.cancelled_at),
    totalPrice: str(record, "total_price"),
    currency: str(record, "currency"),
    orderStatusUrl: str(record, "order_status_url"),
    shopifyCreatedAt: str(record, "created_at"),
  };
}

function contextFromOrder(record: Record<string, unknown>, patch: OrderPatch): TemplateContext {
  const first = patch.customerFirstName ?? null;
  return {
    customer_first_name: first,
    customer_name: first,
    order_name: patch.orderName ?? null,
    order_total: formatTotal(patch.totalPrice ?? null, patch.currency ?? null),
    order_status_url: patch.orderStatusUrl ?? null,
    tracking_number: null,
    tracking_url: null,
    tracking_company: null,
  };
}

function trackingFrom(record: Record<string, unknown>): {
  number: string | null;
  url: string | null;
  company: string | null;
} {
  return {
    number: str(record, "tracking_number") ?? firstString(record.tracking_numbers),
    url: str(record, "tracking_url") ?? firstString(record.tracking_urls),
    company: str(record, "tracking_company"),
  };
}

function formatTotal(amount: string | null, currency: string | null): string | null {
  if (!amount) return null;
  return currency ? `${amount} ${currency}` : amount;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function firstString(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const found = value.find((entry) => typeof entry === "string" && entry.trim());
  return typeof found === "string" ? found.trim() : null;
}
