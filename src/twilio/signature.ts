import { createHmac } from "node:crypto";
import { safeEqual } from "../shopify/hmac.js";

export function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const payload = Object.keys(params)
    .sort()
    .reduce((data, key) => data + key + (params[key] ?? ""), url);
  return createHmac("sha1", authToken).update(payload, "utf8").digest("base64");
}

export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  header: string | undefined,
): boolean {
  if (!header || !authToken) return false;
  const candidates = signatureCandidates(url);
  return candidates.some((candidate) =>
    safeEqual(header.trim(), twilioSignature(authToken, candidate, params)),
  );
}

function signatureCandidates(url: string): string[] {
  const parsed = new URL(url);
  const withoutPort = parsed.port ? withoutExplicitPort(parsed) : parsed.toString();
  const withPort = parsed.port ? parsed.toString() : withStandardPort(parsed);
  return [...new Set([withoutPort, withPort])];
}

function withoutExplicitPort(url: URL): string {
  const copy = new URL(url);
  copy.port = "";
  return copy.toString();
}

function withStandardPort(url: URL): string {
  const copy = new URL(url);
  copy.port = copy.protocol === "https:" ? "443" : "80";
  return copy.toString();
}
