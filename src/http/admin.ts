import express, { type NextFunction, type Request, type Response } from "express";
import { settingsError, settingsSchema } from "../domain/settings.js";
import { normalizeOrderId } from "../domain/order-id.js";
import { AppError } from "../errors.js";
import type { AppDeps } from "./app.js";

export function registerAdminRoutes(app: express.Express, deps: AppDeps): void {
  const api = express.Router();
  api.use(express.json({ limit: "1mb" }));
  api.use((req, res, next) => {
    void requireAdmin(deps, req, res, next);
  });

  api.get("/shop", async (req, res, next) => {
    try {
      const shop = shopOf(res);
      const record = await deps.store.getShop(shop);
      res.json({
        shop,
        name: record?.name ?? shop,
        timezone: record?.timezone ?? "America/New_York",
        devAdmin: deps.env.ALLOW_DEV_ADMIN && deps.env.NODE_ENV === "development",
      });
    } catch (error) {
      next(error);
    }
  });

  api.get("/settings", async (req, res, next) => {
    try {
      const shop = shopOf(res);
      res.json({ settings: await deps.store.getSettings(shop) });
    } catch (error) {
      next(error);
    }
  });

  api.put("/settings", async (req, res, next) => {
    try {
      const shop = shopOf(res);
      const parsed = settingsSchema.safeParse(normalizeSettingsBody(req.body));
      if (!parsed.success) throw new AppError(400, settingsError(parsed.error));
      await deps.store.saveSettings(shop, parsed.data);
      res.json({ settings: parsed.data });
    } catch (error) {
      next(error);
    }
  });

  api.get("/conversations", async (req, res, next) => {
    try {
      const shop = shopOf(res);
      const orders = await deps.store.listOrders(shop, 50);
      const messages = await deps.store.listMessagesForOrders(
        shop,
        orders.map((order) => order.shopifyOrderId),
      );
      const latest = new Map<string, (typeof messages)[number]>();
      for (const message of messages) {
        if (message.shopifyOrderId && !latest.has(message.shopifyOrderId)) {
          latest.set(message.shopifyOrderId, message);
        }
      }
      res.json({
        conversations: orders.map((order) => {
          const message = latest.get(order.shopifyOrderId);
          return {
            shopifyOrderId: order.shopifyOrderId,
            orderName: order.orderName,
            customerFirstName: order.customerFirstName,
            customerPhone: order.customerPhone,
            statusSummary: order.statusSummary,
            updatedAt: order.updatedAt,
            lastMessage: message?.body ?? null,
            lastMessageAt: message?.createdAt ?? null,
            lastDirection: message?.direction ?? null,
          };
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  api.get("/orders/:orderId/thread", async (req, res, next) => {
    try {
      const shop = shopOf(res);
      const orderId = normalizeOrderId(req.params.orderId ?? "");
      const order = await deps.store.getOrder(shop, orderId);
      if (!order) throw new AppError(404, "No messages for this order yet");
      const messages = await deps.store.listMessages(shop, orderId);
      res.json({ order, messages });
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", api);
}

async function requireAdmin(
  deps: AppDeps,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.header("authorization") ?? "";
    const token = /^bearer\s+/i.test(header) ? header.replace(/^bearer\s+/i, "").trim() : "";
    if (token) {
      const { shop } = await deps.shopify.verifySessionToken(token);
      await deps.shopify.ensureInstalled(shop, token);
      res.locals.shopDomain = shop;
      next();
      return;
    }
    if (deps.env.NODE_ENV === "development" && deps.env.ALLOW_DEV_ADMIN) {
      const requested = (req.header("x-dev-shop") ?? "dev-shop.myshopify.com").trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(requested)) {
        throw new AppError(400, "X-Dev-Shop must be a myshopify.com domain");
      }
      await deps.store.upsertShop({
        domain: requested,
        name: "Development shop",
        timezone: "America/New_York",
        installed: true,
      });
      res.locals.shopDomain = requested;
      next();
      return;
    }
    res.status(401).json({ error: "Missing Shopify session token" });
  } catch (error) {
    next(error);
  }
}

function normalizeSettingsBody(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const record = body as Record<string, unknown>;
  return {
    ...record,
    quietHoursStart: trimTime(record.quietHoursStart),
    quietHoursEnd: trimTime(record.quietHoursEnd),
  };
}

function trimTime(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const match = /^(\d{2}:\d{2})/.exec(value);
  return match?.[1] ?? value;
}

function shopOf(res: Response): string {
  const shop = res.locals.shopDomain;
  if (typeof shop !== "string" || !shop) throw new AppError(401, "Missing shop");
  return shop;
}
