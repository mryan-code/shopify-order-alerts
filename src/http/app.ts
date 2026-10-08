import { readFile } from "node:fs/promises";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Env } from "../config/env.js";
import type { Store } from "../db/types.js";
import { AppError } from "../errors.js";
import type { Logger } from "../logger.js";
import { handleInboundSms } from "../services/inbound.js";
import { handleOrderWebhook, type ServiceDeps } from "../services/notifications.js";
import { handlePrivacyWebhook } from "../services/privacy.js";
import type { ShopifyGateway } from "../shopify/gateway.js";
import { verifyShopifyWebhook } from "../shopify/hmac.js";
import type { TwilioSender } from "../twilio/client.js";
import { verifyTwilioSignature } from "../twilio/signature.js";
import { registerAdminRoutes } from "./admin.js";

export interface AppDeps {
  env: Env;
  store: Store;
  shopify: ShopifyGateway;
  twilio: TwilioSender;
  now: () => Date;
  logger: Logger;
  enableDevServer?: boolean;
}

const PRIVACY_TOPICS = new Set(["customers/data_request", "customers/redact", "shop/redact"]);

export async function createApp(deps: AppDeps): Promise<express.Express> {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "frame-ancestors https://admin.shopify.com https://*.myshopify.com",
    );
    const origin = allowedOrigin(req.header("origin"), deps.env.SHOPIFY_APP_URL);
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Dev-Shop");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/auth", async (req, res, next) => {
    try {
      const shop = typeof req.query.shop === "string" ? req.query.shop : "";
      if (!shop) throw new AppError(400, "Missing shop query parameter");
      await deps.shopify.beginAuth(req, res, shop);
    } catch (error) {
      next(error);
    }
  });

  app.get("/auth/callback", async (req, res, next) => {
    try {
      const { shop } = await deps.shopify.completeAuth(req, res);
      const host = typeof req.query.host === "string" ? req.query.host : "";
      const params = new URLSearchParams({ shop, host });
      res.redirect(`/settings?${params.toString()}`);
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/webhooks/shopify",
    express.raw({ type: "application/json", limit: "2mb" }),
    async (req, res, next) => {
      try {
        const raw = bufferBody(req);
        const valid = verifyShopifyWebhook(
          raw,
          req.header("x-shopify-hmac-sha256"),
          deps.env.SHOPIFY_API_SECRET,
        );
        if (!valid) {
          res.status(401).type("text/plain").send("Invalid webhook signature");
          return;
        }
        const topic = req.header("x-shopify-topic") ?? "";
        const shop = req.header("x-shopify-shop-domain") ?? "";
        const webhookId = req.header("x-shopify-webhook-id") ?? "";
        if (!topic || !shop || !webhookId)
          throw new AppError(400, "Missing Shopify webhook headers");
        let payload: unknown;
        try {
          payload = JSON.parse(raw) as unknown;
        } catch {
          throw new AppError(400, "Webhook body is not JSON");
        }
        const service = serviceDeps(deps);
        if (topic.toLowerCase() === "app/uninstalled") {
          const fresh = await deps.store.rememberWebhook(webhookId, topic, shop);
          if (fresh) {
            try {
              await deps.store.markUninstalled(shop);
              await deps.store.deleteSessionsForShop(shop);
            } catch (error) {
              await deps.store.forgetWebhook(webhookId);
              throw error;
            }
          }
          res.status(200).json({ ok: true });
          return;
        }
        if (PRIVACY_TOPICS.has(topic.toLowerCase())) {
          const fresh = await deps.store.rememberWebhook(webhookId, topic, shop);
          if (fresh) {
            try {
              await handlePrivacyWebhook(service, { topic, shop, payload });
            } catch (error) {
              await deps.store.forgetWebhook(webhookId);
              throw error;
            }
          }
          res.status(200).json({ ok: true });
          return;
        }
        const result = await handleOrderWebhook(service, { webhookId, topic, shop, payload });
        deps.logger.info("shopify webhook", {
          topic,
          shop,
          duplicate: result.duplicate,
          enqueued: result.enqueued,
        });
        res.status(200).json({ ok: true, duplicate: result.duplicate, enqueued: result.enqueued });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/webhooks/twilio/sms",
    express.urlencoded({ extended: false }),
    async (req, res, next) => {
      try {
        const params = stringParams(req.body);
        const url = twilioUrl(deps.env.SHOPIFY_APP_URL, req.originalUrl);
        const valid = verifyTwilioSignature(
          deps.env.TWILIO_AUTH_TOKEN,
          url,
          params,
          req.header("x-twilio-signature"),
        );
        if (!valid) {
          res.status(403).type("text/plain").send("Invalid Twilio signature");
          return;
        }
        const twiml = await handleInboundSms(
          {
            store: deps.store,
            now: deps.now,
            phoneCountry: deps.env.DEFAULT_PHONE_COUNTRY,
            fromNumber: deps.env.TWILIO_FROM_NUMBER,
            advancedOptOut: deps.env.TWILIO_ADVANCED_OPT_OUT,
            logger: deps.logger,
          },
          {
            from: params.From ?? "",
            to: params.To ?? "",
            body: params.Body ?? "",
            messageSid: params.MessageSid ?? "",
          },
        );
        res.status(200).type("text/xml").send(twiml);
      } catch (error) {
        next(error);
      }
    },
  );

  registerAdminRoutes(app, deps);

  if (deps.enableDevServer && deps.env.NODE_ENV !== "production") {
    const { createServer } = await import("vite");
    const webRoot = path.resolve(process.cwd(), "web");
    const vite = await createServer({
      root: webRoot,
      configFile: path.join(webRoot, "vite.config.ts"),
      server: { middlewareMode: true },
      appType: "custom",
    });
    app.use(vite.middlewares);
    app.use(async (req, res, next) => {
      if (req.method !== "GET") {
        next();
        return;
      }
      try {
        const template = await readFile(path.join(webRoot, "index.html"), "utf8");
        const html = await vite.transformIndexHtml(
          req.originalUrl,
          withApiKey(template, deps.env, req),
        );
        res.status(200).setHeader("Content-Type", "text/html").send(html);
      } catch (error) {
        vite.ssrFixStacktrace(error as Error);
        next(error);
      }
    });
  } else {
    const dist = path.resolve(process.cwd(), "web/dist");
    app.use(express.static(dist, { index: false }));
    app.use(async (req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api") || req.path.startsWith("/webhooks")) {
        next();
        return;
      }
      try {
        const template = await readFile(path.join(dist, "index.html"), "utf8");
        res
          .status(200)
          .setHeader("Content-Type", "text/html")
          .send(withApiKey(template, deps.env, req));
      } catch {
        res
          .status(200)
          .type("html")
          .send("<p>Order Alerts API is running. Build the admin UI with npm run build.</p>");
      }
    });
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (error instanceof AppError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    deps.logger.error("request failed", {
      error: error instanceof Error ? error.message : "error",
    });
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

function serviceDeps(deps: AppDeps): ServiceDeps {
  return {
    store: deps.store,
    now: deps.now,
    phoneCountry: deps.env.DEFAULT_PHONE_COUNTRY,
    logger: deps.logger,
    graphql: (shop, query, variables) => deps.shopify.graphql(shop, query, variables),
  };
}

function bufferBody(req: Request): string {
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (typeof req.body === "string") return req.body;
  throw new AppError(400, "Expected a raw JSON body");
}

function stringParams(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object") return {};
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}

export function twilioUrl(appUrl: string, originalUrl: string): string {
  const base = appUrl.replace(/\/$/, "");
  return `${base}${originalUrl.startsWith("/") ? originalUrl : `/${originalUrl}`}`;
}

function withApiKey(html: string, env: Env, req: Request): string {
  const embedded = typeof req.query.host === "string" || req.query.embedded === "1";
  const bridge = embedded
    ? `<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>`
    : "";
  return html
    .replaceAll("%SHOPIFY_API_KEY%", escapeHtml(env.SHOPIFY_API_KEY))
    .replace("%APP_BRIDGE%", bridge);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function allowedOrigin(origin: string | undefined, appUrl: string): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    const app = new URL(appUrl);
    if (url.origin === app.origin) return origin;
    if (
      url.hostname === "extensions.shopifycdn.com" ||
      url.hostname.endsWith(".shopify.com") ||
      url.hostname.endsWith(".shopifycdn.com") ||
      url.hostname.endsWith(".myshopify.com")
    ) {
      return origin;
    }
  } catch {
    return null;
  }
  return null;
}
