import { describe, expect, it } from "vitest";
import { mapWebhook } from "../src/domain/events.js";

const order = {
  id: 1001,
  name: "#1001",
  financial_status: "paid",
  fulfillment_status: null,
  total_price: "24.00",
  currency: "USD",
  order_status_url: "https://shop.example/orders/1001",
  customer: { id: 9, first_name: "Ada", phone: "+1 415-555-2671" },
  shipping_address: { first_name: "Ada", phone: "+1 415-555-2671" },
};

describe("mapWebhook", () => {
  it("maps a paid order and ignores an unpaid create", () => {
    expect(mapWebhook("orders/paid", order)[0]?.event).toBe("order_paid");
    expect(mapWebhook("orders/create", order)[0]?.dedupeSuffix).toBe("paid");
    expect(mapWebhook("orders/create", { ...order, financial_status: "pending" })).toEqual([]);
  });

  it("maps shipment, delivery, cancel, and refund events", () => {
    const fulfillment = {
      id: 55,
      order_id: 1001,
      tracking_number: "1Z999",
      tracking_company: "UPS",
      tracking_url: "https://ups.example/1Z999",
      shipment_status: "in_transit",
      destination: { first_name: "Ada", phone: "+14155552671" },
    };
    const shipped = mapWebhook("fulfillments/create", fulfillment)[0];
    expect(shipped?.event).toBe("order_shipped");
    expect(shipped?.dedupeSuffix).toBe("55");
    expect(shipped?.context.tracking_number).toBe("1Z999");
    expect(mapWebhook("fulfillments/update", fulfillment)).toEqual([]);
    expect(
      mapWebhook("fulfillments/update", { ...fulfillment, shipment_status: "delivered" })[0]?.event,
    ).toBe("order_delivered");
    expect(
      mapWebhook("fulfillment_events/create", {
        id: 7,
        order_id: 1001,
        fulfillment_id: 55,
        status: "delivered",
      })[0]?.dedupeSuffix,
    ).toBe("55");
    expect(
      mapWebhook("fulfillment_events/create", { id: 7, order_id: 1001, status: "in_transit" }),
    ).toEqual([]);
    expect(
      mapWebhook("orders/cancelled", { ...order, cancelled_at: "2026-01-02T00:00:00Z" })[0]?.patch
        .cancelled,
    ).toBe(true);
    expect(
      mapWebhook("refunds/create", { id: 90, order_id: "gid://shopify/Order/1001" })[0],
    ).toMatchObject({
      event: "order_refunded",
      dedupeSuffix: "90",
      patch: { shopifyOrderId: "1001" },
    });
  });

  it("ignores topics that are not order notifications", () => {
    expect(mapWebhook("app/uninstalled", { id: 1 })).toEqual([]);
    expect(mapWebhook("orders/updated", order)).toEqual([]);
  });
});
