import type { ServiceDeps } from "./notifications.js";
import { enqueueIntent } from "./notifications.js";
import { fetchStalledOrders, type GraphqlRequester } from "../shopify/orders.js";

export async function scanStalledOrders(deps: ServiceDeps): Promise<number> {
  if (!deps.graphql) return 0;
  const shops = await deps.store.listInstalledShops();
  let enqueued = 0;
  for (const shop of shops) {
    const settings = await deps.store.getSettings(shop.domain);
    const wantsSms = settings.smsEvents.includes("order_stalled");
    const wantsVoice = settings.voiceEvents.includes("order_stalled");
    if (!wantsSms && !wantsVoice) continue;
    const cutoff = new Date(deps.now().getTime() - settings.stalledAfterDays * 24 * 60 * 60 * 1000);
    let intents;
    try {
      const graphql: GraphqlRequester = (query, variables) =>
        deps.graphql?.(shop.domain, query, variables) as Promise<never>;
      intents = await fetchStalledOrders(graphql, cutoff);
    } catch (error) {
      deps.logger.warn("stalled scan failed", {
        shop: shop.domain,
        error: error instanceof Error ? error.message : "error",
      });
      continue;
    }
    for (const intent of intents) {
      const existing = await deps.store.getOrder(shop.domain, intent.patch.shopifyOrderId);
      if (existing?.stalledNotifiedAt) continue;
      enqueued += await enqueueIntent(deps, shop.domain, intent);
    }
  }
  return enqueued;
}
