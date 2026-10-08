import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";
import { createMemoryStore } from "../src/db/memory-store.js";
import { createApp } from "../src/http/app.js";
import { silentLogger } from "../src/logger.js";
import { shopifyWebhookHmac } from "../src/shopify/hmac.js";
import type { ShopifyGateway } from "../src/shopify/gateway.js";
import { twilioSignature } from "../src/twilio/signature.js";
import type { TwilioSender } from "../src/twilio/client.js";

const env = loadEnv({
  SHOPIFY_API_KEY: "your-shopify-api-key",
  SHOPIFY_API_SECRET: "test-shopify-api-secret",
  SCOPES: "read_orders",
  SHOPIFY_APP_URL: "https://your-tunnel.example.com",
  DATABASE_URL: "file:./dev.db",
  TWILIO_ACCOUNT_SID: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  TWILIO_AUTH_TOKEN: "test-twilio-auth-token",
  TWILIO_FROM_NUMBER: "+15555550100",
  NODE_ENV: "test",
  ALLOW_DEV_ADMIN: "false",
});

const shopify: ShopifyGateway = {
  async beginAuth() {},
  async completeAuth() {
    return { shop: "demo.myshopify.com" };
  },
  async verifySessionToken(token) {
    if (token !== "good-token") throw new Error("bad token");
    return { shop: "demo.myshopify.com" };
  },
  async ensureInstalled() {},
  async graphql<T>() {
    return {} as T;
  },
};

const twilio: TwilioSender = {
  async sendSms() {
    return { sid: "SM" };
  },
  async call() {
    return { sid: "CA" };
  },
};

async function app() {
  return createApp({
    env,
    store: createMemoryStore(),
    shopify,
    twilio,
    now: () => new Date("2026-01-15T16:00:00Z"),
    logger: silentLogger,
    enableDevServer: false,
  });
}

describe("http webhooks", () => {
  it("rejects a Shopify webhook with a bad signature", async () => {
    const server = await app();
    const response = await request(server)
      .post("/webhooks/shopify")
      .set("Content-Type", "application/json")
      .set("X-Shopify-Hmac-Sha256", "bad")
      .set("X-Shopify-Topic", "orders/paid")
      .set("X-Shopify-Shop-Domain", "demo.myshopify.com")
      .set("X-Shopify-Webhook-Id", "wh_http")
      .send('{"id":1}');
    expect(response.status).toBe(401);
  });

  it("accepts a signed order webhook and a signed inbound SMS", async () => {
    const server = await app();
    const body = JSON.stringify({
      id: 1001,
      name: "#1001",
      financial_status: "paid",
      customer: { first_name: "Ada", phone: "+14155552671" },
    });
    const paid = await request(server)
      .post("/webhooks/shopify")
      .set("Content-Type", "application/json")
      .set("X-Shopify-Hmac-Sha256", shopifyWebhookHmac(body, env.SHOPIFY_API_SECRET))
      .set("X-Shopify-Topic", "orders/paid")
      .set("X-Shopify-Shop-Domain", "demo.myshopify.com")
      .set("X-Shopify-Webhook-Id", "wh_http_ok")
      .send(body);
    expect(paid.status).toBe(200);
    expect(paid.body.enqueued).toBe(1);

    const params = { Body: "HELP", From: "+14155552671", To: "+15555550100" };
    const url = "https://your-tunnel.example.com/webhooks/twilio/sms";
    const sms = await request(server)
      .post("/webhooks/twilio/sms")
      .set("X-Twilio-Signature", twilioSignature(env.TWILIO_AUTH_TOKEN, url, params))
      .type("form")
      .send(params);
    expect(sms.status).toBe(200);
    expect(sms.text).toContain("STATUS");
    expect(sms.headers["content-type"]).toMatch(/xml/);
  });

  it("requires a session token for the admin API", async () => {
    const server = await app();
    const denied = await request(server).get("/api/settings");
    expect(denied.status).toBe(401);
    const allowed = await request(server)
      .get("/api/settings")
      .set("Authorization", "Bearer good-token");
    expect(allowed.status).toBe(200);
    expect(allowed.body.settings.smsEvents).toContain("order_paid");
  });
});
