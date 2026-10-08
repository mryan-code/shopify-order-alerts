import type { Store } from "../db/types.js";
import { classifyInbound, GLOBAL_OPT_OUT_SHOP } from "../domain/opt-out.js";
import { normalizePhone, isCountryCode } from "../domain/phones.js";
import { renderTemplate } from "../domain/templates.js";
import type { Logger } from "../logger.js";
import { emptyTwiml, messageTwiml } from "../twilio/twiml.js";

export async function handleInboundSms(
  deps: {
    store: Store;
    now: () => Date;
    phoneCountry: string;
    fromNumber: string;
    advancedOptOut: boolean;
    logger: Logger;
  },
  input: { from: string; to: string; body: string; messageSid: string },
): Promise<string> {
  const country = isCountryCode(deps.phoneCountry) ? deps.phoneCountry : "US";
  const from = normalizePhone(input.from, country);
  const to = normalizePhone(input.to, country) ?? deps.fromNumber;
  const intent = classifyInbound(input.body);
  const order = from ? await deps.store.findLatestOrderByPhone(from) : null;
  const shop = order?.shop ?? null;

  if (from) {
    await deps.store.addMessage(
      {
        shop: shop ?? "unmatched",
        shopifyOrderId: order?.shopifyOrderId ?? null,
        direction: "inbound",
        channel: "sms",
        body: input.body,
        status: "received",
        twilioSid: input.messageSid,
        fromPhone: from,
        toPhone: to,
      },
      deps.now(),
    );
  }

  if (intent === "opt_out" && from) {
    if (shop) await deps.store.optOut(shop, from, deps.now());
    await deps.store.optOut(GLOBAL_OPT_OUT_SHOP, from, deps.now());
    deps.logger.info("customer opted out", { shop: shop ?? "unmatched" });
    if (deps.advancedOptOut) return emptyTwiml();
    const settings = shop ? await deps.store.getSettings(shop) : null;
    return messageTwiml(
      settings?.optOutMessage ?? "You are unsubscribed. Reply START to opt back in.",
    );
  }

  if (intent === "opt_in" && from) {
    await deps.store.optIn(from);
    deps.logger.info("customer opted in", { shop: shop ?? "unmatched" });
    if (deps.advancedOptOut) return emptyTwiml();
    return messageTwiml("You are subscribed to order texts again. Reply STOP to unsubscribe.");
  }

  if (intent === "help") {
    if (deps.advancedOptOut) return emptyTwiml();
    const settings = shop ? await deps.store.getSettings(shop) : null;
    return messageTwiml(
      settings?.helpMessage ??
        "Reply STATUS for your latest order update, STOP to unsubscribe, or START to resubscribe.",
    );
  }

  if (intent === "status") {
    if (!order) return messageTwiml("We could not find an order for this phone number.");
    const settings = await deps.store.getSettings(order.shop);
    const body = renderTemplate(settings.statusTemplate, {
      order_name: order.orderName,
      status_summary: order.statusSummary,
      customer_first_name: order.customerFirstName,
      shop_name: (await deps.store.getShop(order.shop))?.name ?? order.shop,
      tracking_number: order.trackingNumber,
      tracking_url: order.trackingUrl,
      tracking_company: order.trackingCompany,
    });
    return messageTwiml(body);
  }

  return emptyTwiml();
}
