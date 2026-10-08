import { normalizeOrderId } from "../domain/order-id.js";
import { normalizePhone, isCountryCode } from "../domain/phones.js";
import type { ServiceDeps } from "./notifications.js";

export async function handlePrivacyWebhook(
  deps: ServiceDeps,
  input: { topic: string; shop: string; payload: unknown },
): Promise<void> {
  const topic = input.topic.toLowerCase();
  const record = asRecord(input.payload) ?? {};
  if (topic === "shop/redact") {
    await deps.store.redactShop(input.shop);
    return;
  }
  if (topic === "customers/redact") {
    await deps.store.redactCustomer(customerSelector(input.shop, record, deps.phoneCountry));
    await deps.store.recordPrivacyRequest(input.shop, topic, JSON.stringify(record));
    return;
  }
  if (topic === "customers/data_request") {
    const selector = customerSelector(input.shop, record, deps.phoneCountry);
    const orders = await deps.store.listOrders(input.shop, 100);
    const matched = orders.filter((order) => {
      if (selector.orderIds.includes(order.shopifyOrderId)) return true;
      if (selector.customerId && order.customerId === selector.customerId) return true;
      if (selector.email && order.email === selector.email) return true;
      if (selector.phone && order.customerPhone === selector.phone) return true;
      return false;
    });
    const messages = await deps.store.listMessagesForOrders(
      input.shop,
      matched.map((order) => order.shopifyOrderId),
    );
    await deps.store.recordPrivacyRequest(
      input.shop,
      topic,
      JSON.stringify({ request: record, orders: matched, messages }),
    );
  }
}

function customerSelector(shop: string, payload: Record<string, unknown>, phoneCountry: string) {
  const customer = asRecord(payload.customer);
  const country = isCountryCode(phoneCountry) ? phoneCountry : "US";
  const phone = normalizePhone(
    typeof customer?.phone === "string" ? customer.phone : null,
    country,
  );
  const email = typeof customer?.email === "string" ? customer.email.toLowerCase() : null;
  const customerId =
    customer && (typeof customer.id === "number" || typeof customer.id === "string")
      ? normalizeOrderId(customer.id)
      : null;
  const rawIds = Array.isArray(payload.orders_to_redact)
    ? payload.orders_to_redact
    : Array.isArray(payload.orders_requested)
      ? payload.orders_requested
      : [];
  const orderIds = rawIds
    .filter((id): id is string | number => typeof id === "string" || typeof id === "number")
    .map((id) => normalizeOrderId(id));
  return { shop, customerId, email, phone, orderIds };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
