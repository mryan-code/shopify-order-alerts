import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";

const valid = {
  SHOPIFY_API_KEY: "your-shopify-api-key",
  SHOPIFY_API_SECRET: "your-shopify-api-secret",
  SCOPES: "read_orders,read_customers",
  SHOPIFY_APP_URL: "https://your-tunnel.example.com",
  DATABASE_URL: "file:./dev.db",
  TWILIO_ACCOUNT_SID: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  TWILIO_AUTH_TOKEN: "your-twilio-auth-token",
  TWILIO_FROM_NUMBER: "+15555550100",
};

describe("loadEnv", () => {
  it("lists every missing variable", () => {
    expect(() => loadEnv({})).toThrow(/SHOPIFY_API_KEY/);
    expect(() => loadEnv({})).toThrow(/TWILIO_AUTH_TOKEN/);
    expect(() => loadEnv({})).toThrow(/Copy \.sample\.env/);
  });

  it("accepts the sample placeholders and applies defaults", () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.SHOPIFY_API_VERSION).toBe("2026-01");
    expect(env.SCOPES).toEqual(["read_orders", "read_customers"]);
    expect(env.ALLOW_DEV_ADMIN).toBe(false);
    expect(env.SHOPIFY_APP_URL).toBe("https://your-tunnel.example.com");
  });

  it("rejects a sender number that is not E.164", () => {
    expect(() => loadEnv({ ...valid, TWILIO_FROM_NUMBER: "555-0100" })).toThrow(
      /TWILIO_FROM_NUMBER/,
    );
  });

  it("rejects an account SID that Twilio would refuse", () => {
    expect(() => loadEnv({ ...valid, TWILIO_ACCOUNT_SID: "your-twilio-account-sid" })).toThrow(
      /TWILIO_ACCOUNT_SID/,
    );
  });
});
