import { Prisma, PrismaClient } from "@prisma/client";
import { GLOBAL_OPT_OUT_SHOP } from "../domain/opt-out.js";
import { defaultSettings } from "../domain/settings.js";
import type { EventType } from "../domain/types.js";
import { mergeOrder } from "./merge.js";
import { settingsFromRow, settingsToRow } from "./settings-row.js";
import type { JobRecord, MessageRecord, OrderRecord, ShopRecord, Store } from "./types.js";

export function createPrismaStore(prisma: PrismaClient, phoneCountry = "US"): Store {
  return {
    async rememberWebhook(id, topic, shop) {
      try {
        await prisma.webhookDelivery.create({ data: { id, topic, shop } });
        return true;
      } catch (error) {
        if (isUnique(error)) return false;
        throw error;
      }
    },
    async forgetWebhook(id) {
      await prisma.webhookDelivery.deleteMany({ where: { id } });
    },
    async getShop(domain) {
      const shop = await prisma.shop.findUnique({ where: { domain } });
      return shop ? toShop(shop) : null;
    },
    async upsertShop(input) {
      const shop = await prisma.shop.upsert({
        where: { domain: input.domain },
        create: {
          domain: input.domain,
          name: input.name ?? null,
          timezone: input.timezone ?? "America/New_York",
          installed: input.installed ?? true,
        },
        update: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.timezone ? { timezone: input.timezone } : {}),
          ...(input.installed !== undefined
            ? { installed: input.installed, uninstalledAt: null }
            : {}),
        },
      });
      return toShop(shop);
    },
    async markUninstalled(domain) {
      await prisma.shop.updateMany({
        where: { domain },
        data: { installed: false, uninstalledAt: new Date() },
      });
    },
    async listInstalledShops() {
      const shops = await prisma.shop.findMany({ where: { installed: true } });
      return shops.map(toShop);
    },
    async getSettings(shop) {
      const row = await prisma.shopSettings.findUnique({ where: { shop } });
      const shopRow = await prisma.shop.findUnique({ where: { domain: shop } });
      const timezone = shopRow?.timezone ?? "America/New_York";
      if (row) return settingsFromRow(row, timezone);
      if (!shopRow) {
        await prisma.shop.create({ data: { domain: shop, timezone } });
      }
      const settings = defaultSettings(timezone);
      await prisma.shopSettings.create({ data: { shop, ...settingsToRow(settings) } });
      return settings;
    },
    async saveSettings(shop, settings) {
      const shopRow = await prisma.shop.findUnique({ where: { domain: shop } });
      if (!shopRow) {
        await prisma.shop.create({
          data: { domain: shop, timezone: settings.quietHoursTimezone },
        });
      }
      const data = settingsToRow(settings);
      await prisma.shopSettings.upsert({
        where: { shop },
        create: { shop, ...data },
        update: data,
      });
    },
    async upsertOrder(shop, patch, at) {
      const existing = await prisma.orderRecord.findUnique({
        where: { shop_shopifyOrderId: { shop, shopifyOrderId: patch.shopifyOrderId } },
      });
      const merged = mergeOrder(existing ? toOrder(existing) : null, shop, patch, at, phoneCountry);
      const saved = await prisma.orderRecord.upsert({
        where: { shop_shopifyOrderId: { shop, shopifyOrderId: patch.shopifyOrderId } },
        create: orderData(merged),
        update: orderData(merged),
      });
      return toOrder(saved);
    },
    async getOrder(shop, shopifyOrderId) {
      const order = await prisma.orderRecord.findUnique({
        where: { shop_shopifyOrderId: { shop, shopifyOrderId } },
      });
      return order ? toOrder(order) : null;
    },
    async listOrders(shop, limit) {
      const orders = await prisma.orderRecord.findMany({
        where: { shop },
        orderBy: { updatedAt: "desc" },
        take: limit,
      });
      return orders.map(toOrder);
    },
    async listMessages(shop, shopifyOrderId) {
      const rows = await prisma.message.findMany({
        where: { shop, shopifyOrderId },
        orderBy: { createdAt: "asc" },
        take: 200,
      });
      return rows.map(toMessage);
    },
    async listMessagesForOrders(shop, orderIds) {
      if (orderIds.length === 0) return [];
      const rows = await prisma.message.findMany({
        where: { shop, shopifyOrderId: { in: orderIds } },
        orderBy: { createdAt: "desc" },
      });
      return rows.map(toMessage);
    },
    async addMessage(input, at) {
      const row = await prisma.message.create({
        data: {
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
          createdAt: at,
        },
      });
      return toMessage(row);
    },
    async findLatestOrderByPhone(phone) {
      const order = await prisma.orderRecord.findFirst({
        where: { customerPhone: phone },
        orderBy: { updatedAt: "desc" },
      });
      return order ? toOrder(order) : null;
    },
    async isOptedOut(shop, phone) {
      const row = await prisma.optOut.findFirst({
        where: { phone, shop: { in: [shop, GLOBAL_OPT_OUT_SHOP] } },
      });
      return Boolean(row);
    },
    async optOut(shop, phone) {
      await prisma.optOut.upsert({
        where: { shop_phone: { shop, phone } },
        create: { shop, phone },
        update: {},
      });
    },
    async optIn(phone) {
      await prisma.optOut.deleteMany({ where: { phone } });
    },
    async enqueue(job) {
      try {
        await prisma.outboundJob.create({
          data: {
            dedupeKey: job.dedupeKey,
            shop: job.shop,
            shopifyOrderId: job.shopifyOrderId,
            eventType: job.eventType,
            channel: job.channel,
            toPhone: job.toPhone,
            body: job.body,
            nextAttemptAt: job.nextAttemptAt,
            maxAttempts: job.maxAttempts ?? 5,
          },
        });
        return "created";
      } catch (error) {
        if (!isUnique(error)) throw error;
        const existing = await prisma.outboundJob.findUnique({
          where: { dedupeKey: job.dedupeKey },
        });
        if (existing && existing.status === "pending" && job.body.length > existing.body.length) {
          await prisma.outboundJob.update({ where: { id: existing.id }, data: { body: job.body } });
        }
        return "duplicate";
      }
    },
    async claimDue(at, limit) {
      const due = await prisma.outboundJob.findMany({
        where: { status: "pending", nextAttemptAt: { lte: at } },
        orderBy: { nextAttemptAt: "asc" },
        take: limit,
      });
      const claimed = [];
      for (const job of due) {
        const result = await prisma.outboundJob.updateMany({
          where: { id: job.id, status: "pending" },
          data: { status: "processing" },
        });
        if (result.count === 1) claimed.push({ ...job, status: "processing" });
      }
      return claimed.map(toJob);
    },
    async markJobSent(id, sid) {
      await prisma.outboundJob.update({
        where: { id },
        data: { status: "sent", twilioSid: sid, lastError: null },
      });
    },
    async markJobRetry(id, error, nextAttemptAt) {
      await prisma.outboundJob.update({
        where: { id },
        data: { status: "pending", attempts: { increment: 1 }, lastError: error, nextAttemptAt },
      });
    },
    async markJobFailed(id, error) {
      await prisma.outboundJob.update({
        where: { id },
        data: { status: "failed", attempts: { increment: 1 }, lastError: error },
      });
    },
    async markJobSuppressed(id, reason) {
      await prisma.outboundJob.update({
        where: { id },
        data: { status: "suppressed", lastError: reason },
      });
    },
    async rescheduleJob(id, nextAttemptAt) {
      await prisma.outboundJob.update({
        where: { id },
        data: { status: "pending", nextAttemptAt },
      });
    },
    async releaseStuckJobs() {
      await prisma.outboundJob.updateMany({
        where: { status: "processing" },
        data: { status: "pending" },
      });
    },
    async markStalledNotified(shop, shopifyOrderId, at) {
      await prisma.orderRecord.updateMany({
        where: { shop, shopifyOrderId },
        data: { stalledNotifiedAt: at },
      });
    },
    async redactCustomer(input) {
      const email = input.email?.toLowerCase() ?? null;
      const or: Prisma.OrderRecordWhereInput[] = [];
      if (input.orderIds.length > 0) or.push({ shopifyOrderId: { in: input.orderIds } });
      if (input.customerId) or.push({ customerId: input.customerId });
      if (email) or.push({ email });
      if (input.phone) or.push({ customerPhone: input.phone });
      const orders =
        or.length === 0
          ? []
          : await prisma.orderRecord.findMany({
              where: { shop: input.shop, OR: or },
              select: { shopifyOrderId: true },
            });
      const ids = orders.map((order) => order.shopifyOrderId);
      if (ids.length > 0) {
        await prisma.message.deleteMany({
          where: { shop: input.shop, shopifyOrderId: { in: ids } },
        });
        await prisma.orderRecord.deleteMany({
          where: { shop: input.shop, shopifyOrderId: { in: ids } },
        });
      }
      if (input.phone) {
        await prisma.message.deleteMany({
          where: {
            shop: input.shop,
            OR: [{ fromPhone: input.phone }, { toPhone: input.phone }],
          },
        });
        await prisma.optOut.deleteMany({
          where: { phone: input.phone, shop: { in: [input.shop, GLOBAL_OPT_OUT_SHOP] } },
        });
      }
    },
    async redactShop(shop) {
      await prisma.$transaction([
        prisma.message.deleteMany({ where: { shop } }),
        prisma.outboundJob.deleteMany({ where: { shop } }),
        prisma.orderRecord.deleteMany({ where: { shop } }),
        prisma.optOut.deleteMany({ where: { shop } }),
        prisma.shopifySession.deleteMany({ where: { shop } }),
        prisma.webhookDelivery.deleteMany({ where: { shop } }),
        prisma.privacyRequest.deleteMany({ where: { shop } }),
        prisma.shopSettings.deleteMany({ where: { shop } }),
        prisma.shop.deleteMany({ where: { domain: shop } }),
      ]);
    },
    async recordPrivacyRequest(shop, topic, payload) {
      await prisma.privacyRequest.create({ data: { shop, topic, payload } });
    },
    async saveSession(session) {
      await prisma.shopifySession.upsert({
        where: { id: session.id },
        create: {
          ...session,
          expires: session.expires ? new Date(session.expires) : null,
        },
        update: {
          ...session,
          expires: session.expires ? new Date(session.expires) : null,
        },
      });
    },
    async loadSession(id) {
      const session = await prisma.shopifySession.findUnique({ where: { id } });
      if (!session) return null;
      return {
        id: session.id,
        shop: session.shop,
        state: session.state,
        isOnline: session.isOnline,
        scope: session.scope,
        expires: session.expires?.toISOString() ?? null,
        accessToken: session.accessToken,
        onlineAccessInfo: session.onlineAccessInfo,
      };
    },
    async deleteSessionsForShop(shop) {
      await prisma.shopifySession.deleteMany({ where: { shop } });
    },
  };
}

function toShop(shop: {
  domain: string;
  name: string | null;
  timezone: string;
  installed: boolean;
}): ShopRecord {
  return {
    domain: shop.domain,
    name: shop.name,
    timezone: shop.timezone,
    installed: shop.installed,
  };
}

function orderData(order: OrderRecord) {
  return {
    shop: order.shop,
    shopifyOrderId: order.shopifyOrderId,
    orderName: order.orderName,
    customerFirstName: order.customerFirstName,
    customerId: order.customerId,
    email: order.email,
    customerPhone: order.customerPhone,
    financialStatus: order.financialStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    cancelled: order.cancelled,
    totalPrice: order.totalPrice,
    currency: order.currency,
    orderStatusUrl: order.orderStatusUrl,
    trackingNumber: order.trackingNumber,
    trackingUrl: order.trackingUrl,
    trackingCompany: order.trackingCompany,
    statusSummary: order.statusSummary,
    stalledNotifiedAt: order.stalledNotifiedAt ? new Date(order.stalledNotifiedAt) : null,
    shopifyCreatedAt: order.shopifyCreatedAt ? new Date(order.shopifyCreatedAt) : null,
    updatedAt: new Date(order.updatedAt),
  };
}

function toOrder(order: {
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
  statusSummary: string | null;
  stalledNotifiedAt: Date | null;
  shopifyCreatedAt: Date | null;
  updatedAt: Date;
}): OrderRecord {
  return {
    shop: order.shop,
    shopifyOrderId: order.shopifyOrderId,
    orderName: order.orderName,
    customerFirstName: order.customerFirstName,
    customerId: order.customerId,
    email: order.email,
    customerPhone: order.customerPhone,
    financialStatus: order.financialStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    cancelled: order.cancelled,
    totalPrice: order.totalPrice,
    currency: order.currency,
    orderStatusUrl: order.orderStatusUrl,
    trackingNumber: order.trackingNumber,
    trackingUrl: order.trackingUrl,
    trackingCompany: order.trackingCompany,
    statusSummary: order.statusSummary ?? "",
    stalledNotifiedAt: order.stalledNotifiedAt?.toISOString() ?? null,
    shopifyCreatedAt: order.shopifyCreatedAt?.toISOString() ?? null,
    updatedAt: order.updatedAt.toISOString(),
  };
}

function toMessage(message: {
  id: string;
  shop: string;
  shopifyOrderId: string | null;
  direction: string;
  channel: string;
  body: string;
  status: string;
  twilioSid: string | null;
  eventType: string | null;
  fromPhone: string | null;
  toPhone: string | null;
  createdAt: Date;
}): MessageRecord {
  return {
    id: message.id,
    shop: message.shop,
    shopifyOrderId: message.shopifyOrderId,
    direction: message.direction === "inbound" ? "inbound" : "outbound",
    channel: message.channel === "voice" ? "voice" : "sms",
    body: message.body,
    status: message.status,
    twilioSid: message.twilioSid,
    eventType: message.eventType as EventType | null,
    fromPhone: message.fromPhone,
    toPhone: message.toPhone,
    createdAt: message.createdAt.toISOString(),
  };
}

function toJob(job: {
  id: string;
  dedupeKey: string;
  shop: string;
  shopifyOrderId: string;
  eventType: string;
  channel: string;
  toPhone: string;
  body: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  twilioSid: string | null;
}): JobRecord {
  return {
    id: job.id,
    dedupeKey: job.dedupeKey,
    shop: job.shop,
    shopifyOrderId: job.shopifyOrderId,
    eventType: job.eventType as EventType,
    channel: job.channel === "voice" ? "voice" : "sms",
    toPhone: job.toPhone,
    body: job.body,
    status: job.status as JobRecord["status"],
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    nextAttemptAt: job.nextAttemptAt.toISOString(),
    lastError: job.lastError,
    twilioSid: job.twilioSid,
  };
}

function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
