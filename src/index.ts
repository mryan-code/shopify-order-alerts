import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { loadEnv } from "./config/env.js";
import { createPrismaStore } from "./db/prisma-store.js";
import { createApp } from "./http/app.js";
import { startSchedulers } from "./jobs/scheduler.js";
import { consoleLogger } from "./logger.js";
import { createShopifyGateway } from "./shopify/gateway.js";
import { createTwilioSender } from "./twilio/client.js";

loadDotenv({ path: resolve(process.cwd(), ".env") });

const env = loadEnv();
const logger = consoleLogger;
const prisma = new PrismaClient();
const store = createPrismaStore(prisma, env.DEFAULT_PHONE_COUNTRY);
const shopify = createShopifyGateway(env, store, logger);
const twilio = createTwilioSender({
  accountSid: env.TWILIO_ACCOUNT_SID,
  authToken: env.TWILIO_AUTH_TOKEN,
  fromNumber: env.TWILIO_FROM_NUMBER,
});

const app = await createApp({
  env,
  store,
  shopify,
  twilio,
  now: () => new Date(),
  logger,
  enableDevServer: env.NODE_ENV !== "production",
});

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info("order alerts listening", { port: env.PORT, host: env.HOST });
});

const stop = startSchedulers(
  {
    store,
    twilio,
    now: () => new Date(),
    phoneCountry: env.DEFAULT_PHONE_COUNTRY,
    logger,
    graphql: (shop, query, variables) => shopify.graphql(shop, query, variables),
  },
  { pollMs: env.WORKER_POLL_MS, stalledMs: env.STALLED_SCAN_MS },
);

async function shutdown(): Promise<void> {
  stop();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  await prisma.$disconnect();
}

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
