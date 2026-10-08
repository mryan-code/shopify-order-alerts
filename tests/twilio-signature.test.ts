import { describe, expect, it } from "vitest";
import { verifyTwilioSignature } from "../src/twilio/signature.js";

const token = "test-twilio-auth-token";
const url = "https://your-tunnel.example.com/webhooks/twilio/sms";
const params = { Body: "STATUS", From: "+14155552671", To: "+15555550100" };
const signature = "f6O8kb9SyH9wu6qGraATf0C8RI8=";

describe("verifyTwilioSignature", () => {
  it("accepts the signature for the public webhook URL", () => {
    expect(verifyTwilioSignature(token, url, params, signature)).toBe(true);
  });

  it("rejects a changed body and a missing header", () => {
    expect(verifyTwilioSignature(token, url, { ...params, Body: "STOP" }, signature)).toBe(false);
    expect(verifyTwilioSignature(token, url, params, undefined)).toBe(false);
  });
});
