import "@shopify/shopify-api/adapters/node";
import {
  ApiVersion,
  LogSeverity,
  RequestedTokenType,
  Session,
  shopifyApi,
  type Shopify,
} from "@shopify/shopify-api";
import type { Request, Response } from "express";
import type { Env } from "../config/env.js";
import type { Store, StoredSession } from "../db/types.js";
import { AppError } from "../errors.js";
import type { Logger } from "../logger.js";
import { adminGraphql, fetchShopInfo } from "./orders.js";

export interface ShopifyGateway {
  beginAuth(req: Request, res: Response, shop: string): Promise<void>;
  completeAuth(req: Request, res: Response): Promise<{ shop: string }>;
  verifySessionToken(token: string): Promise<{ shop: string }>;
  ensureInstalled(shop: string, sessionToken: string): Promise<void>;
  graphql<T>(shop: string, query: string, variables?: Record<string, unknown>): Promise<T>;
}

export function createShopifyGateway(env: Env, store: Store, logger: Logger): ShopifyGateway {
  const appUrl = new URL(env.SHOPIFY_APP_URL);
  const api = shopifyApi({
    apiKey: env.SHOPIFY_API_KEY,
    apiSecretKey: env.SHOPIFY_API_SECRET,
    scopes: env.SCOPES,
    hostName: appUrl.host,
    hostScheme: appUrl.protocol === "https:" ? "https" : "http",
    apiVersion: toApiVersion(env.SHOPIFY_API_VERSION),
    isEmbeddedApp: true,
    logger: { level: LogSeverity.Error },
  });

  return {
    async beginAuth(req, res, shop) {
      const clean = requireShop(api, shop);
      await api.auth.begin({
        shop: clean,
        callbackPath: "/auth/callback",
        isOnline: false,
        rawRequest: req,
        rawResponse: res,
      });
    },
    async completeAuth(req, res) {
      const callback = await api.auth.callback({ rawRequest: req, rawResponse: res });
      await store.saveSession(toStoredSession(callback.session));
      applyHeaders(res, callback.headers);
      await refreshShop(api, store, env, callback.session.shop, logger);
      return { shop: callback.session.shop };
    },
    async verifySessionToken(token) {
      const payload = await api.session.decodeSessionToken(token);
      const shop = shopFromDest(payload.dest);
      const clean = requireShop(api, shop);
      return { shop: clean };
    },
    async ensureInstalled(shop, sessionToken) {
      const clean = requireShop(api, shop);
      const offlineId = api.session.getOfflineId(clean);
      const existing = await store.loadSession(offlineId);
      if (!existing?.accessToken) {
        const exchanged = await api.auth.tokenExchange({
          shop: clean,
          sessionToken,
          requestedTokenType: RequestedTokenType.OfflineAccessToken,
        });
        await store.saveSession(toStoredSession(exchanged.session));
      }
      await refreshShop(api, store, env, clean, logger);
    },
    async graphql(shop, query, variables) {
      const clean = requireShop(api, shop);
      const session = await store.loadSession(api.session.getOfflineId(clean));
      if (!session?.accessToken) {
        throw new AppError(401, "This shop is not installed. Open the app from the Shopify admin.");
      }
      return adminGraphql({
        shop: clean,
        version: env.SHOPIFY_API_VERSION,
        token: session.accessToken,
        query,
        variables,
      });
    },
  };
}

async function refreshShop(
  api: Shopify,
  store: Store,
  env: Env,
  shop: string,
  logger: Logger,
): Promise<void> {
  const current = await store.getShop(shop);
  if (current?.name && current.installed) return;
  try {
    const session = await store.loadSession(api.session.getOfflineId(shop));
    if (!session?.accessToken) {
      await store.upsertShop({ domain: shop, installed: true });
      return;
    }
    const info = await fetchShopInfo((query, variables) =>
      adminGraphql({
        shop,
        version: env.SHOPIFY_API_VERSION,
        token: session.accessToken ?? "",
        query,
        variables,
      }),
    );
    await store.upsertShop({
      domain: shop,
      name: info.name,
      timezone: info.timezone,
      installed: true,
    });
  } catch (error) {
    logger.warn("shop profile lookup failed", {
      shop,
      error: error instanceof Error ? error.message : "error",
    });
    await store.upsertShop({ domain: shop, installed: true });
  }
}

function toStoredSession(session: Session): StoredSession {
  return {
    id: session.id,
    shop: session.shop,
    state: session.state,
    isOnline: session.isOnline,
    scope: session.scope ?? null,
    expires: session.expires ? session.expires.toISOString() : null,
    accessToken: session.accessToken ?? null,
    onlineAccessInfo: session.onlineAccessInfo ? JSON.stringify(session.onlineAccessInfo) : null,
  };
}

function applyHeaders(
  res: Response,
  headers: Record<string, string | string[] | undefined> | undefined,
): void {
  if (!headers) return;
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) res.setHeader(key, value);
  }
}

function shopFromDest(dest: string): string {
  try {
    return new URL(dest).hostname;
  } catch {
    return dest.replace(/^https?:\/\//, "").split("/")[0] ?? dest;
  }
}

function requireShop(api: Shopify, shop: string): string {
  const clean = api.utils.sanitizeShop(shop);
  if (!clean) throw new AppError(400, "Shop domain must look like example.myshopify.com");
  return clean;
}

export function toApiVersion(version: string): ApiVersion {
  const values = new Set(Object.values(ApiVersion));
  if (!values.has(version as ApiVersion)) {
    throw new Error(
      `SHOPIFY_API_VERSION ${version} is not supported by the installed Shopify library. Use one of: ${[...values].join(", ")}`,
    );
  }
  return version as ApiVersion;
}
