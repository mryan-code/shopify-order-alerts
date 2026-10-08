import { describe, expect, it } from "vitest";
import { verifyShopifyWebhook } from "../src/shopify/hmac.js";

const secret = "test-shopify-api-secret";
const body = '{"id":1001,"name":"#1001"}';
const signature = "OyQy6see/oJgCKuVNJBQiQHiduz5ZHEFFtNA7hCoYuA=";

describe("verifyShopifyWebhook", () => {
  it("accepts a valid HMAC and rejects tampering", () => {
    expect(verifyShopifyWebhook(body, signature, secret)).toBe(true);
    expect(verifyShopifyWebhook(`${body} `, signature, secret)).toBe(false);
    expect(verifyShopifyWebhook(body, signature, "other-secret")).toBe(false);
    expect(verifyShopifyWebhook(body, undefined, secret)).toBe(false);
    expect(verifyShopifyWebhook(body, "not-base64", secret)).toBe(false);
  });
});
