import type { OrderPatch } from "../domain/events.js";
import { normalizePhone, isCountryCode } from "../domain/phones.js";
import { summarizeOrder } from "../domain/summary.js";
import type { OrderRecord } from "./types.js";

export function mergeOrder(
  existing: OrderRecord | null,
  shop: string,
  patch: OrderPatch,
  now: Date,
  defaultCountry: string,
): OrderRecord {
  const country = isCountryCode(defaultCountry) ? defaultCountry : "US";
  const phoneInput =
    patch.customerPhone === undefined ? existing?.customerPhone : patch.customerPhone;
  const normalizedPhone = phoneInput
    ? (normalizePhone(phoneInput, country) ?? existing?.customerPhone ?? null)
    : null;
  const emailInput = pick(patch.email, existing?.email ?? null);
  const next: OrderRecord = {
    shop,
    shopifyOrderId: patch.shopifyOrderId,
    orderName: patch.orderName ?? existing?.orderName ?? `#${patch.shopifyOrderId}`,
    customerFirstName: pick(patch.customerFirstName, existing?.customerFirstName ?? null),
    customerId: pick(patch.customerId, existing?.customerId ?? null),
    email: emailInput ? emailInput.toLowerCase() : null,
    customerPhone: normalizedPhone,
    financialStatus: pick(patch.financialStatus, existing?.financialStatus ?? null),
    fulfillmentStatus: pick(patch.fulfillmentStatus, existing?.fulfillmentStatus ?? null),
    cancelled: patch.cancelled ?? existing?.cancelled ?? false,
    totalPrice: pick(patch.totalPrice, existing?.totalPrice ?? null),
    currency: pick(patch.currency, existing?.currency ?? null),
    orderStatusUrl: pick(patch.orderStatusUrl, existing?.orderStatusUrl ?? null),
    trackingNumber: pick(patch.trackingNumber, existing?.trackingNumber ?? null),
    trackingUrl: pick(patch.trackingUrl, existing?.trackingUrl ?? null),
    trackingCompany: pick(patch.trackingCompany, existing?.trackingCompany ?? null),
    statusSummary: "",
    stalledNotifiedAt: existing?.stalledNotifiedAt ?? null,
    shopifyCreatedAt: pick(patch.shopifyCreatedAt, existing?.shopifyCreatedAt ?? null),
    updatedAt: now.toISOString(),
  };
  next.statusSummary = summarizeOrder(next);
  return next;
}

function pick<T>(patchValue: T | undefined, current: T): T {
  return patchValue === undefined ? current : patchValue;
}
