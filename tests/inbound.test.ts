import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/db/memory-store.js";
import { silentLogger } from "../src/logger.js";
import { handleInboundSms } from "../src/services/inbound.js";

async function seed() {
  const store = createMemoryStore();
  await store.upsertShop({ domain: "demo.myshopify.com", name: "Demo" });
  await store.upsertOrder(
    "demo.myshopify.com",
    {
      shopifyOrderId: "1001",
      orderName: "#1001",
      customerFirstName: "Ada",
      customerPhone: "+14155552671",
      financialStatus: "paid",
    },
    new Date("2026-01-15T12:00:00Z"),
  );
  return store;
}

function deps(store: Awaited<ReturnType<typeof seed>>) {
  return {
    store,
    now: () => new Date("2026-01-15T18:00:00Z"),
    phoneCountry: "US",
    fromNumber: "+15555550100",
    advancedOptOut: false,
    logger: silentLogger,
  };
}

describe("handleInboundSms", () => {
  it("opts the customer out and confirms with TwiML", async () => {
    const store = await seed();
    const twiml = await handleInboundSms(deps(store), {
      from: "+14155552671",
      to: "+15555550100",
      body: "STOP",
      messageSid: "SM1",
    });
    expect(twiml).toContain("unsubscribed");
    expect(await store.isOptedOut("demo.myshopify.com", "+14155552671")).toBe(true);
    const messages = await store.listMessages("demo.myshopify.com", "1001");
    expect(messages.some((message) => message.direction === "inbound")).toBe(true);
  });

  it("answers STATUS from the latest order and stores the reply on that thread", async () => {
    const store = await seed();
    const twiml = await handleInboundSms(deps(store), {
      from: "+14155552671",
      to: "+15555550100",
      body: "status",
      messageSid: "SM2",
    });
    expect(twiml).toContain("#1001");
    expect(twiml).toContain("paid, not yet shipped");
  });

  it("returns help copy and lets START undo the opt-out", async () => {
    const store = await seed();
    const context = deps(store);
    const help = await handleInboundSms(context, {
      from: "+14155552671",
      to: "+15555550100",
      body: "HELP",
      messageSid: "SM3",
    });
    expect(help).toContain("STATUS");
    await handleInboundSms(context, {
      from: "+14155552671",
      to: "+15555550100",
      body: "STOP",
      messageSid: "SM4",
    });
    const start = await handleInboundSms(context, {
      from: "+14155552671",
      to: "+15555550100",
      body: "START",
      messageSid: "SM5",
    });
    expect(start).toContain("subscribed");
    expect(await store.isOptedOut("demo.myshopify.com", "+14155552671")).toBe(false);
  });

  it("stores a freeform reply without sending another text", async () => {
    const store = await seed();
    const twiml = await handleInboundSms(deps(store), {
      from: "+14155552671",
      to: "+15555550100",
      body: "Can you leave it at the door?",
      messageSid: "SM6",
    });
    expect(twiml).toBe(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
    const messages = await store.listMessages("demo.myshopify.com", "1001");
    expect(messages.at(-1)?.body).toContain("door");
  });
});
