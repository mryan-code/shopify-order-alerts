export function summarizeOrder(order: {
  cancelled: boolean;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  trackingNumber: string | null;
}): string {
  if (order.cancelled) return "cancelled";
  const financial = (order.financialStatus ?? "").toLowerCase();
  const fulfillment = (order.fulfillmentStatus ?? "").toLowerCase();
  if (financial === "refunded") return "refunded";
  if (financial === "partially_refunded") return "partially refunded";
  if (fulfillment === "delivered") return "delivered";
  if (
    fulfillment === "fulfilled" ||
    fulfillment === "partial" ||
    fulfillment === "partially_fulfilled" ||
    fulfillment === "shipped" ||
    fulfillment === "in_transit" ||
    order.trackingNumber
  ) {
    return order.trackingNumber ? `shipped, tracking ${order.trackingNumber}` : "shipped";
  }
  if (financial === "paid" || financial === "partially_paid") return "paid, not yet shipped";
  if (financial) return financial.replaceAll("_", " ");
  return "open";
}
