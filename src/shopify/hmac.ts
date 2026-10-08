import { createHmac, timingSafeEqual } from "node:crypto";

export function shopifyWebhookHmac(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
}

export function verifyShopifyWebhook(
  rawBody: string,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header || !secret) return false;
  const expected = shopifyWebhookHmac(rawBody, secret);
  return safeEqual(header.trim(), expected);
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
