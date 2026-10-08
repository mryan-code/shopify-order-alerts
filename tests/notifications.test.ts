import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/db/memory-store.js";
import { handleOrderWebhook } from "../src/services/notifications.js";
import { silentLogger } from "../src/logger.js";

const shop = "demo.myshopify.com";
const order = {
  id: 1001,
  name: "#1001",
  financial_status: "paid",
  total_price: "24.00",
  currency: "USD",
  customer: { id: 9, first_name: "Ada", phone: "+14155552671" },
  shipping_address: { first_name: "Ada", phone: "+14155552671" },
};

function deps(now = new Date("2026-01-15T15:00:00-05:00")) {
  return {
    store: createMemoryStore(),
    now: () => now,
    phoneCountry: "US",
    logger: silentLogger,
  };
}

describe("handleOrderWebhook", () => {
  it("queues one SMS for a paid order and ignores a duplicate delivery", async () => {
    const context = deps();
    await context.store.upsertShop({ domain: shop, name: "Demo", timezone: "America/New_York" });
    const first = await handleOrderWebhook(context, {
      webhookId: "wh_1",
      topic: "orders/paid",
      shop,
      payload: order,
    });
    const second = await handleOrderWebhook(context, {
      webhookId: "wh_1",
      topic: "orders/paid",
      shop,
      payload: order,
    });
    expect(first).toEqual({ duplicate: false, enqueued: 1 });
    expect(second.duplicate).toBe(true);
    const jobs = await context.store.claimDue(new Date("2026-01-15T16:00:00-05:00"), 10);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.channel).toBe("sms");
    expect(jobs[0]?.body).toContain("Ada");
    expect(jobs[0]?.body).toContain("#1001");
  });

  it("does not queue when the customer has opted out", async () => {
    const context = deps();
    await context.store.upsertShop({ domain: shop, name: "Demo" });
    await context.store.optOut(shop, "+14155552671", new Date());
    const result = await handleOrderWebhook(context, {
      webhookId: "wh_2",
      topic: "orders/paid",
      shop,
      payload: order,
    });
    expect(result.enqueued).toBe(0);
    const messages = await context.store.listMessages(shop, "1001");
    expect(messages[0]?.status).toBe("suppressed");
  });

  it("defers the job until quiet hours end", async () => {
    const context = deps(new Date("2026-01-15T22:30:00-05:00"));
    await context.store.upsertShop({ domain: shop, name: "Demo", timezone: "America/New_York" });
    await handleOrderWebhook(context, {
      webhookId: "wh_3",
      topic: "orders/paid",
      shop,
      payload: order,
    });
    const tooSoon = await context.store.claimDue(new Date("2026-01-15T23:00:00-05:00"), 10);
    expect(tooSoon).toHaveLength(0);
    const ready = await context.store.claimDue(new Date("2026-01-16T08:05:00-05:00"), 10);
    expect(ready).toHaveLength(1);
  });

  it("skips orders with no phone number", async () => {
    const context = deps();
    await context.store.upsertShop({ domain: shop, name: "Demo" });
    const result = await handleOrderWebhook(context, {
      webhookId: "wh_4",
      topic: "orders/paid",
      shop,
      payload: {
        ...order,
        customer: { id: 9, first_name: "Ada" },
        shipping_address: { first_name: "Ada" },
      },
    });
    expect(result.enqueued).toBe(0);
    const messages = await context.store.listMessages(shop, "1001");
    expect(messages[0]?.status).toBe("skipped");
  });
});
