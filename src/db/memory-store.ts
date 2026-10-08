import { randomUUID } from "node:crypto";
import { GLOBAL_OPT_OUT_SHOP } from "../domain/opt-out.js";
import { defaultSettings } from "../domain/settings.js";
import type { ShopSettings } from "../domain/types.js";
import { mergeOrder } from "./merge.js";
import type {
  JobRecord,
  MessageRecord,
  OrderRecord,
  ShopRecord,
  Store,
  StoredSession,
} from "./types.js";

interface MemoryOptions {
  phoneCountry?: string;
}

export function createMemoryStore(options: MemoryOptions = {}): Store {
  const phoneCountry = options.phoneCountry ?? "US";
  const shops = new Map<string, ShopRecord>();
  const settings = new Map<string, ShopSettings>();
  const sessions = new Map<string, StoredSession>();
  const orders = new Map<string, OrderRecord>();
  const messages: MessageRecord[] = [];
  const jobs: JobRecord[] = [];
  const webhooks = new Map<string, { topic: string; shop: string }>();
  const optOuts: { shop: string; phone: string }[] = [];
  const privacy: { shop: string; topic: string; payload: string }[] = [];

  function orderKey(shop: string, id: string): string {
    return `${shop}:${id}`;
  }

  const store: Store = {
    async rememberWebhook(id, topic, shop) {
      if (webhooks.has(id)) return false;
      webhooks.set(id, { topic, shop });
      return true;
    },
    async forgetWebhook(id) {
      webhooks.delete(id);
    },
    async getShop(domain) {
      return shops.get(domain) ?? null;
    },
    async upsertShop(input) {
      const current = shops.get(input.domain);
      const record: ShopRecord = {
        domain: input.domain,
        name: input.name === undefined ? (current?.name ?? null) : input.name,
        timezone: input.timezone ?? current?.timezone ?? "America/New_York",
        installed: input.installed ?? true,
      };
      shops.set(input.domain, record);
      return record;
    },
    async markUninstalled(domain) {
      const current = shops.get(domain);
      if (!current) return;
      shops.set(domain, { ...current, installed: false });
    },
    async listInstalledShops() {
      return [...shops.values()].filter((shop) => shop.installed);
    },
    async getSettings(shop) {
      const existing = settings.get(shop);
      if (existing) return existing;
      const timezone = shops.get(shop)?.timezone ?? "America/New_York";
      if (!shops.has(shop)) {
        shops.set(shop, { domain: shop, name: null, timezone, installed: true });
      }
      const created = defaultSettings(timezone);
      settings.set(shop, created);
      return created;
    },
    async saveSettings(shop, value) {
      if (!shops.has(shop)) {
        shops.set(shop, {
          domain: shop,
          name: null,
          timezone: value.quietHoursTimezone,
          installed: true,
        });
      }
      settings.set(shop, value);
    },
    async upsertOrder(shop, patch, at) {
      const key = orderKey(shop, patch.shopifyOrderId);
      const merged = mergeOrder(orders.get(key) ?? null, shop, patch, at, phoneCountry);
      orders.set(key, merged);
      return merged;
    },
    async getOrder(shop, shopifyOrderId) {
      return orders.get(orderKey(shop, shopifyOrderId)) ?? null;
    },
    async listOrders(shop, limit) {
      return [...orders.values()]
        .filter((order) => order.shop === shop)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit);
    },
    async listMessages(shop, shopifyOrderId) {
      return messages
        .filter((message) => message.shop === shop && message.shopifyOrderId === shopifyOrderId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, 200);
    },
    async listMessagesForOrders(shop, orderIds) {
      const ids = new Set(orderIds);
      return messages
        .filter(
          (message) =>
            message.shop === shop && message.shopifyOrderId && ids.has(message.shopifyOrderId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async addMessage(input, at) {
      const message: MessageRecord = {
        id: randomUUID(),
        shop: input.shop,
        shopifyOrderId: input.shopifyOrderId,
        direction: input.direction,
        channel: input.channel,
        body: input.body,
        status: input.status,
        twilioSid: input.twilioSid ?? null,
        eventType: input.eventType ?? null,
        fromPhone: input.fromPhone ?? null,
        toPhone: input.toPhone ?? null,
        createdAt: at.toISOString(),
      };
      messages.push(message);
      return message;
    },
    async findLatestOrderByPhone(phone) {
      return (
        [...orders.values()]
          .filter((order) => order.customerPhone === phone)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
      );
    },
    async isOptedOut(shop, phone) {
      return optOuts.some(
        (row) => row.phone === phone && (row.shop === shop || row.shop === GLOBAL_OPT_OUT_SHOP),
      );
    },
    async optOut(shop, phone) {
      if (!optOuts.some((row) => row.shop === shop && row.phone === phone)) {
        optOuts.push({ shop, phone });
      }
    },
    async optIn(phone) {
      for (let index = optOuts.length - 1; index >= 0; index -= 1) {
        if (optOuts[index]?.phone === phone) optOuts.splice(index, 1);
      }
    },
    async enqueue(job) {
      const existing = jobs.find((item) => item.dedupeKey === job.dedupeKey);
      if (existing) {
        if (existing.status === "pending" && job.body.length > existing.body.length)
          existing.body = job.body;
        return "duplicate";
      }
      jobs.push({
        id: randomUUID(),
        dedupeKey: job.dedupeKey,
        shop: job.shop,
        shopifyOrderId: job.shopifyOrderId,
        eventType: job.eventType,
        channel: job.channel,
        toPhone: job.toPhone,
        body: job.body,
        status: "pending",
        attempts: 0,
        maxAttempts: job.maxAttempts ?? 5,
        nextAttemptAt: job.nextAttemptAt.toISOString(),
        lastError: null,
        twilioSid: null,
      });
      return "created";
    },
    async claimDue(at, limit) {
      const due = jobs
        .filter((job) => job.status === "pending" && Date.parse(job.nextAttemptAt) <= at.getTime())
        .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt))
        .slice(0, limit);
      for (const job of due) job.status = "processing";
      return due.map((job) => ({ ...job }));
    },
    async markJobSent(id, sid) {
      const job = requireJob(jobs, id);
      job.status = "sent";
      job.twilioSid = sid;
      job.lastError = null;
    },
    async markJobRetry(id, error, nextAttemptAt) {
      const job = requireJob(jobs, id);
      job.status = "pending";
      job.attempts += 1;
      job.lastError = error;
      job.nextAttemptAt = nextAttemptAt.toISOString();
    },
    async markJobFailed(id, error) {
      const job = requireJob(jobs, id);
      job.status = "failed";
      job.attempts += 1;
      job.lastError = error;
    },
    async markJobSuppressed(id, reason) {
      const job = requireJob(jobs, id);
      job.status = "suppressed";
      job.lastError = reason;
    },
    async rescheduleJob(id, nextAttemptAt) {
      const job = requireJob(jobs, id);
      job.status = "pending";
      job.nextAttemptAt = nextAttemptAt.toISOString();
    },
    async releaseStuckJobs() {
      for (const job of jobs) {
        if (job.status === "processing") job.status = "pending";
      }
    },
    async markStalledNotified(shop, shopifyOrderId, at) {
      const order = orders.get(orderKey(shop, shopifyOrderId));
      if (order) order.stalledNotifiedAt = at.toISOString();
    },
    async redactCustomer(input) {
      const ids = new Set(input.orderIds);
      const email = input.email?.toLowerCase() ?? null;
      const remove = [...orders.values()].filter((order) => {
        if (order.shop !== input.shop) return false;
        return (
          ids.has(order.shopifyOrderId) ||
          (input.customerId !== null && order.customerId === input.customerId) ||
          (email !== null && order.email === email) ||
          (input.phone !== null && order.customerPhone === input.phone)
        );
      });
      const removeIds = new Set(remove.map((order) => order.shopifyOrderId));
      for (const order of remove) orders.delete(orderKey(order.shop, order.shopifyOrderId));
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (!message || message.shop !== input.shop) continue;
        const matchesOrder = message.shopifyOrderId ? removeIds.has(message.shopifyOrderId) : false;
        const matchesPhone =
          input.phone !== null &&
          (message.fromPhone === input.phone || message.toPhone === input.phone);
        if (matchesOrder || matchesPhone) messages.splice(index, 1);
      }
      if (input.phone) {
        for (let index = optOuts.length - 1; index >= 0; index -= 1) {
          const row = optOuts[index];
          if (
            row?.phone === input.phone &&
            (row.shop === input.shop || row.shop === GLOBAL_OPT_OUT_SHOP)
          ) {
            optOuts.splice(index, 1);
          }
        }
      }
    },
    async redactShop(shop) {
      shops.delete(shop);
      settings.delete(shop);
      for (const [id, session] of sessions) if (session.shop === shop) sessions.delete(id);
      for (const key of [...orders.keys()]) if (key.startsWith(`${shop}:`)) orders.delete(key);
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.shop === shop) messages.splice(index, 1);
      }
      for (let index = jobs.length - 1; index >= 0; index -= 1) {
        if (jobs[index]?.shop === shop) jobs.splice(index, 1);
      }
      for (const [id, webhook] of webhooks) if (webhook.shop === shop) webhooks.delete(id);
      for (let index = optOuts.length - 1; index >= 0; index -= 1) {
        if (optOuts[index]?.shop === shop) optOuts.splice(index, 1);
      }
      for (let index = privacy.length - 1; index >= 0; index -= 1) {
        if (privacy[index]?.shop === shop) privacy.splice(index, 1);
      }
    },
    async recordPrivacyRequest(shop, topic, payload) {
      privacy.push({ shop, topic, payload });
    },
    async saveSession(session) {
      sessions.set(session.id, session);
    },
    async loadSession(id) {
      return sessions.get(id) ?? null;
    },
    async deleteSessionsForShop(shop) {
      for (const [id, session] of sessions) if (session.shop === shop) sessions.delete(id);
    },
  };

  return store;
}

function requireJob(jobs: JobRecord[], id: string): JobRecord {
  const job = jobs.find((item) => item.id === id);
  if (!job) throw new Error(`Unknown job ${id}`);
  return job;
}
