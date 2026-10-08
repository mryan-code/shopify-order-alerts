import { describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "../src/db/memory-store.js";
import { processDueJobs, retryDelayMs } from "../src/jobs/process.js";
import { silentLogger } from "../src/logger.js";
import { TwilioSendError, type TwilioSender } from "../src/twilio/client.js";

function sender(impl?: Partial<TwilioSender>): TwilioSender {
  return {
    sendSms: impl?.sendSms ?? vi.fn(async () => ({ sid: "SM_ok" })),
    call: impl?.call ?? vi.fn(async () => ({ sid: "CA_ok" })),
  };
}

describe("processDueJobs", () => {
  it("sends a due SMS and records the Twilio sid", async () => {
    const store = createMemoryStore();
    const now = new Date("2026-01-15T16:00:00Z");
    await store.enqueue({
      dedupeKey: "sms-1",
      shop: "demo.myshopify.com",
      shopifyOrderId: "1001",
      eventType: "order_paid",
      channel: "sms",
      toPhone: "+14155552671",
      body: "Hello",
      nextAttemptAt: now,
    });
    const twilio = sender();
    const result = await processDueJobs({ store, twilio, now: () => now, logger: silentLogger });
    expect(result.sent).toBe(1);
    expect(twilio.sendSms).toHaveBeenCalledWith("+14155552671", "Hello");
    const messages = await store.listMessages("demo.myshopify.com", "1001");
    expect(messages[0]?.twilioSid).toBe("SM_ok");
  });

  it("retries with backoff and then marks the job failed", async () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(120_000);
    const store = createMemoryStore();
    const now = new Date("2026-01-15T16:00:00Z");
    await store.enqueue({
      dedupeKey: "sms-2",
      shop: "demo.myshopify.com",
      shopifyOrderId: "1001",
      eventType: "order_shipped",
      channel: "sms",
      toPhone: "+14155552671",
      body: "Shipped",
      nextAttemptAt: now,
      maxAttempts: 2,
    });
    const twilio = sender({
      sendSms: vi.fn(async () => {
        throw new TwilioSendError("down", 500);
      }),
    });
    await processDueJobs({ store, twilio, now: () => now, logger: silentLogger });
    await processDueJobs({
      store,
      twilio,
      now: () => new Date(now.getTime() + 60_000),
      logger: silentLogger,
    });
    const messages = await store.listMessages("demo.myshopify.com", "1001");
    expect(messages.at(-1)?.status).toBe("failed");
  });

  it("suppresses a send when the phone is opted out", async () => {
    const store = createMemoryStore();
    const now = new Date("2026-01-15T16:00:00Z");
    await store.optOut("demo.myshopify.com", "+14155552671", now);
    await store.enqueue({
      dedupeKey: "sms-3",
      shop: "demo.myshopify.com",
      shopifyOrderId: "1001",
      eventType: "order_paid",
      channel: "sms",
      toPhone: "+14155552671",
      body: "Hello",
      nextAttemptAt: now,
    });
    const twilio = sender();
    const result = await processDueJobs({ store, twilio, now: () => now, logger: silentLogger });
    expect(result.suppressed).toBe(1);
    expect(twilio.sendSms).not.toHaveBeenCalled();
  });

  it("places a voice call with the rendered body", async () => {
    const store = createMemoryStore();
    const now = new Date("2026-01-15T16:00:00Z");
    await store.enqueue({
      dedupeKey: "voice-1",
      shop: "demo.myshopify.com",
      shopifyOrderId: "1001",
      eventType: "order_delivered",
      channel: "voice",
      toPhone: "+14155552671",
      body: "Your order was delivered",
      nextAttemptAt: now,
    });
    const twilio = sender();
    await processDueJobs({ store, twilio, now: () => now, logger: silentLogger });
    expect(twilio.call).toHaveBeenCalledWith("+14155552671", "Your order was delivered");
  });
});
