import type { Conversation, OrderDetails, ShopSettings, ThreadMessage } from "./types";

interface ShopifyBridge {
  idToken?: () => Promise<string>;
}

declare global {
  interface Window {
    shopify?: ShopifyBridge;
  }
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function sessionToken(): Promise<string | null> {
  const bridge = window.shopify;
  if (!bridge?.idToken) return null;
  try {
    return await bridge.idToken();
  } catch {
    return null;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await sessionToken();
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  else headers.set("X-Dev-Shop", "dev-shop.myshopify.com");
  if (init?.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as { error?: string }) : {};
  if (!response.ok) {
    throw new ApiError(response.status, payload.error ?? `Request failed (${response.status})`);
  }
  return payload as T;
}

export function loadShop(): Promise<{ shop: string; name: string; devAdmin: boolean }> {
  return api("/api/shop");
}

export function loadSettings(): Promise<{ settings: ShopSettings }> {
  return api("/api/settings");
}

export function saveSettings(settings: ShopSettings): Promise<{ settings: ShopSettings }> {
  return api("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
}

export function loadConversations(): Promise<{ conversations: Conversation[] }> {
  return api("/api/conversations");
}

export function loadThread(
  orderId: string,
): Promise<{ order: OrderDetails; messages: ThreadMessage[] }> {
  return api(`/api/orders/${encodeURIComponent(orderId)}/thread`);
}
