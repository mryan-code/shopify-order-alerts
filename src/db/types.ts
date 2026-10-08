import type { OrderPatch } from "../domain/events.js";
import type { EventType, ShopSettings } from "../domain/types.js";

export interface ShopRecord {
  domain: string;
  name: string | null;
  timezone: string;
  installed: boolean;
}

export interface OrderRecord {
  shop: string;
  shopifyOrderId: string;
  orderName: string;
  customerFirstName: string | null;
  customerId: string | null;
  email: string | null;
  customerPhone: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  cancelled: boolean;
  totalPrice: string | null;
  currency: string | null;
  orderStatusUrl: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  trackingCompany: string | null;
  statusSummary: string;
  stalledNotifiedAt: string | null;
  shopifyCreatedAt: string | null;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  shop: string;
  shopifyOrderId: string | null;
  direction: "inbound" | "outbound";
  channel: "sms" | "voice";
  body: string;
  status: string;
  twilioSid: string | null;
  eventType: EventType | null;
  fromPhone: string | null;
  toPhone: string | null;
  createdAt: string;
}

export interface NewMessage {
  shop: string;
  shopifyOrderId: string | null;
  direction: "inbound" | "outbound";
  channel: "sms" | "voice";
  body: string;
  status: string;
  twilioSid?: string | null;
  eventType?: EventType | null;
  fromPhone?: string | null;
  toPhone?: string | null;
}

export interface JobRecord {
  id: string;
  dedupeKey: string;
  shop: string;
  shopifyOrderId: string;
  eventType: EventType;
  channel: "sms" | "voice";
  toPhone: string;
  body: string;
  status: "pending" | "processing" | "sent" | "failed" | "suppressed";
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  twilioSid: string | null;
}

export interface NewJob {
  dedupeKey: string;
  shop: string;
  shopifyOrderId: string;
  eventType: EventType;
  channel: "sms" | "voice";
  toPhone: string;
  body: string;
  nextAttemptAt: Date;
  maxAttempts?: number;
}

export interface StoredSession {
  id: string;
  shop: string;
  state: string;
  isOnline: boolean;
  scope: string | null;
  expires: string | null;
  accessToken: string | null;
  onlineAccessInfo: string | null;
}

export interface RedactCustomer {
  shop: string;
  customerId: string | null;
  email: string | null;
  phone: string | null;
  orderIds: string[];
}

export interface Store {
  rememberWebhook(id: string, topic: string, shop: string): Promise<boolean>;
  forgetWebhook(id: string): Promise<void>;
  getShop(domain: string): Promise<ShopRecord | null>;
  upsertShop(input: {
    domain: string;
    name?: string | null;
    timezone?: string | null;
    installed?: boolean;
  }): Promise<ShopRecord>;
  markUninstalled(domain: string): Promise<void>;
  listInstalledShops(): Promise<ShopRecord[]>;
  getSettings(shop: string): Promise<ShopSettings>;
  saveSettings(shop: string, settings: ShopSettings): Promise<void>;
  upsertOrder(shop: string, patch: OrderPatch, now: Date): Promise<OrderRecord>;
  getOrder(shop: string, shopifyOrderId: string): Promise<OrderRecord | null>;
  listOrders(shop: string, limit: number): Promise<OrderRecord[]>;
  listMessages(shop: string, shopifyOrderId: string): Promise<MessageRecord[]>;
  listMessagesForOrders(shop: string, orderIds: string[]): Promise<MessageRecord[]>;
  addMessage(input: NewMessage, now: Date): Promise<MessageRecord>;
  findLatestOrderByPhone(phone: string): Promise<OrderRecord | null>;
  isOptedOut(shop: string, phone: string): Promise<boolean>;
  optOut(shop: string, phone: string, now: Date): Promise<void>;
  optIn(phone: string): Promise<void>;
  enqueue(job: NewJob): Promise<"created" | "duplicate">;
  claimDue(now: Date, limit: number): Promise<JobRecord[]>;
  markJobSent(id: string, sid: string): Promise<void>;
  markJobRetry(id: string, error: string, nextAttemptAt: Date): Promise<void>;
  markJobFailed(id: string, error: string): Promise<void>;
  markJobSuppressed(id: string, reason: string): Promise<void>;
  rescheduleJob(id: string, nextAttemptAt: Date): Promise<void>;
  releaseStuckJobs(): Promise<void>;
  markStalledNotified(shop: string, shopifyOrderId: string, now: Date): Promise<void>;
  redactCustomer(input: RedactCustomer): Promise<void>;
  redactShop(shop: string): Promise<void>;
  recordPrivacyRequest(shop: string, topic: string, payload: string): Promise<void>;
  saveSession(session: StoredSession): Promise<void>;
  loadSession(id: string): Promise<StoredSession | null>;
  deleteSessionsForShop(shop: string): Promise<void>;
}
