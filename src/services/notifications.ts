import type { Store } from "../db/types.js";
import { mapWebhook, type NotificationIntent, type OrderPatch } from "../domain/events.js";
import { normalizeOrderId } from "../domain/order-id.js";
import { nextSendTime } from "../domain/quiet-hours.js";
import { renderTemplate } from "../domain/templates.js";
import type { EventType, ShopSettings, TemplateContext } from "../domain/types.js";
import type { Logger } from "../logger.js";
import { fetchOrderContact, type GraphqlRequester } from "../shopify/orders.js";

export interface ServiceDeps {
  store: Store;
  now: () => Date;
  phoneCountry: string;
  logger: Logger;
  graphql?: (shop: string, query: string, variables?: Record<string, unknown>) => Promise<unknown>;
}

export async function handleOrderWebhook(
  deps: ServiceDeps,
  input: { webhookId: string; topic: string; shop: string; payload: unknown },
): Promise<{ duplicate: boolean; enqueued: number }> {
  const fresh = await deps.store.rememberWebhook(input.webhookId, input.topic, input.shop);
  if (!fresh) return { duplicate: true, enqueued: 0 };
  try {
    const intents = mapWebhook(input.topic, input.payload);
    let enqueued = 0;
    for (const intent of intents) {
      enqueued += await enqueueIntent(deps, input.shop, intent);
    }
    return { duplicate: false, enqueued };
  } catch (error) {
    await deps.store.forgetWebhook(input.webhookId);
    throw error;
  }
}

export async function enqueueIntent(
  deps: ServiceDeps,
  shop: string,
  intent: NotificationIntent,
): Promise<number> {
  const settings = await deps.store.getSettings(shop);
  const channels = enabledChannels(settings, intent.event);
  if (channels.length === 0) return 0;

  let patch = intent.patch;
  let order = await deps.store.upsertOrder(shop, patch, deps.now());
  if (!order.customerPhone && deps.graphql) {
    const enriched = await enrich(deps, shop, order.shopifyOrderId);
    if (enriched) {
      patch = { ...patch, ...stripUndefined(enriched) };
      order = await deps.store.upsertOrder(shop, patch, deps.now());
    }
  }

  const shopRecord = await deps.store.getShop(shop);
  const context: TemplateContext = {
    ...intent.context,
    customer_first_name: order.customerFirstName,
    customer_name: order.customerFirstName,
    order_name: order.orderName,
    order_total: order.totalPrice
      ? `${order.totalPrice}${order.currency ? ` ${order.currency}` : ""}`
      : null,
    tracking_number: order.trackingNumber ?? intent.context.tracking_number ?? null,
    tracking_url: order.trackingUrl ?? intent.context.tracking_url ?? null,
    tracking_company: order.trackingCompany ?? intent.context.tracking_company ?? null,
    order_status_url: order.orderStatusUrl,
    shop_name: shopRecord?.name ?? shop,
    status_summary: order.statusSummary,
  };

  if (!order.customerPhone) {
    await deps.store.addMessage(
      {
        shop,
        shopifyOrderId: order.shopifyOrderId,
        direction: "outbound",
        channel: "sms",
        body: "No mobile number is on this order, so nothing was sent.",
        status: "skipped",
        eventType: intent.event,
      },
      deps.now(),
    );
    return 0;
  }

  if (await deps.store.isOptedOut(shop, order.customerPhone)) {
    await deps.store.addMessage(
      {
        shop,
        shopifyOrderId: order.shopifyOrderId,
        direction: "outbound",
        channel: channels[0] ?? "sms",
        body: "Customer is opted out, so nothing was sent.",
        status: "suppressed",
        eventType: intent.event,
        toPhone: order.customerPhone,
      },
      deps.now(),
    );
    if (intent.event === "order_stalled")
      await deps.store.markStalledNotified(shop, order.shopifyOrderId, deps.now());
    return 0;
  }

  const sendAt = nextSendTime(deps.now(), settings);
  let created = 0;
  for (const channel of channels) {
    const body = renderTemplate(settings.templates[intent.event], context);
    const result = await deps.store.enqueue({
      dedupeKey: `${shop}:${order.shopifyOrderId}:${intent.event}:${intent.dedupeSuffix}:${channel}`,
      shop,
      shopifyOrderId: order.shopifyOrderId,
      eventType: intent.event,
      channel,
      toPhone: order.customerPhone,
      body,
      nextAttemptAt: sendAt,
    });
    if (result === "created") created += 1;
  }
  if (intent.event === "order_stalled")
    await deps.store.markStalledNotified(shop, order.shopifyOrderId, deps.now());
  return created;
}

export function dedupeKeyFor(
  shop: string,
  orderId: string,
  event: EventType,
  suffix: string,
  channel: string,
): string {
  return `${shop}:${normalizeOrderId(orderId)}:${event}:${suffix}:${channel}`;
}

function enabledChannels(settings: ShopSettings, event: EventType): Array<"sms" | "voice"> {
  const channels: Array<"sms" | "voice"> = [];
  if (settings.smsEvents.includes(event)) channels.push("sms");
  if (settings.voiceEvents.includes(event)) channels.push("voice");
  return channels;
}

async function enrich(
  deps: ServiceDeps,
  shop: string,
  orderId: string,
): Promise<OrderPatch | null> {
  if (!deps.graphql) return null;
  try {
    const graphql: GraphqlRequester = (query, variables) =>
      deps.graphql?.(shop, query, variables) as Promise<never>;
    return await fetchOrderContact(graphql, orderId);
  } catch (error) {
    deps.logger.warn("order enrichment failed", {
      shop,
      orderId,
      error: error instanceof Error ? error.message : "error",
    });
    return null;
  }
}

function stripUndefined(patch: OrderPatch): OrderPatch {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as OrderPatch;
}
