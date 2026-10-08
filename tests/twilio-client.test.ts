import { describe, expect, it, vi } from "vitest";
import type { Twilio } from "twilio";
import { createTwilioSender } from "../src/twilio/client.js";

describe("createTwilioSender", () => {
  it("sends SMS and voice through the Twilio SDK", async () => {
    const messages = { create: vi.fn(async () => ({ sid: "SM123" })) };
    const calls = { create: vi.fn(async () => ({ sid: "CA123" })) };
    const factory = vi.fn(
      () =>
        ({
          messages,
          calls,
        }) as unknown as Twilio,
    );
    const sender = createTwilioSender(
      {
        accountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        authToken: "your-twilio-auth-token",
        fromNumber: "+15555550100",
      },
      factory,
    );
    await expect(sender.sendSms("+14155552671", "Hello")).resolves.toEqual({ sid: "SM123" });
    await expect(sender.call("+14155552671", "Hello & welcome")).resolves.toEqual({ sid: "CA123" });
    expect(messages.create).toHaveBeenCalledWith({
      to: "+14155552671",
      from: "+15555550100",
      body: "Hello",
    });
    expect(calls.create).toHaveBeenCalledWith({
      to: "+14155552671",
      from: "+15555550100",
      twiml: `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Hello &amp; welcome</Say></Response>`,
    });
    expect(factory).toHaveBeenCalledWith("ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "your-twilio-auth-token");
  });
});
