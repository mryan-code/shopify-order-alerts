import { normalizeOrderId } from "../domain/order-id.js";
import type { NotificationIntent, OrderPatch } from "../domain/events.js";
import type { TemplateContext } from "../domain/types.js";

export interface GraphqlRequester {
  <T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

interface Money {
  amount: string;
  currencyCode: string;
}

interface OrderNode {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  phone: string | null;
  email: string | null;
  statusPageUrl?: string | null;
  customer: { id: string; firstName: string | null; phone: string | null } | null;
  shippingAddress: { phone: string | null; firstName: string | null } | null;
  currentTotalPriceSet: { shopMoney: Money } | null;
}

const ORDER_FIELDS = `
  id
  name
  createdAt
  cancelledAt
  displayFinancialStatus
  displayFulfillmentStatus
  phone
  email
  statusPageUrl
  customer { id firstName phone }
  shippingAddress { phone firstName }
  currentTotalPriceSet { shopMoney { amount currencyCode } }
`;

const ORDER_QUERY = `#graphql
  query OrderContact($id: ID!) {
    order(id: $id) { ${ORDER_FIELDS} }
  }
`;

const STALLED_QUERY = `#graphql
  query StalledOrders($query: String!, $cursor: String) {
    orders(first: 25, query: $query, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { ${ORDER_FIELDS} }
    }
  }
`;

const SHOP_QUERY = `#graphql
  query ShopInfo {
    shop { name ianaTimezone }
  }
`;

export async function fetchShopInfo(
  graphql: GraphqlRequester,
): Promise<{ name: string; timezone: string }> {
  const data = await graphql<{ shop: { name: string; ianaTimezone: string } }>(SHOP_QUERY);
  return { name: data.shop.name, timezone: data.shop.ianaTimezone };
}

export async function fetchOrderContact(
  graphql: GraphqlRequester,
  shopifyOrderId: string,
): Promise<OrderPatch | null> {
  const data = await graphql<{ order: OrderNode | null }>(ORDER_QUERY, {
    id: `gid://shopify/Order/${normalizeOrderId(shopifyOrderId)}`,
  });
  if (!data.order) return null;
  return patchFromNode(data.order);
}

export async function fetchStalledOrders(
  graphql: GraphqlRequester,
  cutoff: Date,
): Promise<NotificationIntent[]> {
  const query = `financial_status:paid fulfillment_status:unfulfilled status:open created_at:<'${cutoff.toISOString()}'`;
  const intents: NotificationIntent[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 5; page += 1) {
    const data: StalledResponse = await graphql<StalledResponse>(STALLED_QUERY, { query, cursor });
    for (const node of data.orders.nodes) {
      if (node.cancelledAt) continue;
      if ((node.displayFulfillmentStatus ?? "").toUpperCase() !== "UNFULFILLED") continue;
      const created = new Date(node.createdAt);
      if (Number.isNaN(created.getTime()) || created.getTime() > cutoff.getTime()) continue;
      const patch = patchFromNode(node);
      intents.push({
        event: "order_stalled",
        dedupeSuffix: "stalled",
        patch,
        context: contextFromPatch(patch),
      });
    }
    if (!data.orders.pageInfo.hasNextPage || !data.orders.pageInfo.endCursor) break;
    cursor = data.orders.pageInfo.endCursor;
  }
  return intents;
}

export async function adminGraphql<T>(args: {
  shop: string;
  version: string;
  token: string;
  query: string;
  variables?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<T> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const response = await fetchImpl(`https://${args.shop}/admin/api/${args.version}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": args.token,
    },
    body: JSON.stringify({ query: args.query, variables: args.variables ?? {} }),
  });
  if (!response.ok) {
    throw new Error(`Shopify GraphQL request failed with HTTP ${response.status}`);
  }
  const json = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }
  if (!json.data) throw new Error("Shopify GraphQL returned no data");
  return json.data;
}

interface StalledResponse {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: OrderNode[];
  };
}

function patchFromNode(node: OrderNode): OrderPatch {
  const phone = node.shippingAddress?.phone ?? node.customer?.phone ?? node.phone;
  const money = node.currentTotalPriceSet?.shopMoney;
  return {
    shopifyOrderId: normalizeOrderId(node.id),
    orderName: node.name,
    customerFirstName: node.shippingAddress?.firstName ?? node.customer?.firstName ?? null,
    customerId: node.customer?.id ? normalizeOrderId(node.customer.id) : null,
    email: node.email,
    customerPhone: phone,
    financialStatus: node.displayFinancialStatus?.toLowerCase() ?? null,
    fulfillmentStatus: node.displayFulfillmentStatus?.toLowerCase() ?? null,
    cancelled: Boolean(node.cancelledAt),
    totalPrice: money?.amount ?? null,
    currency: money?.currencyCode ?? null,
    orderStatusUrl: node.statusPageUrl ?? null,
    shopifyCreatedAt: node.createdAt,
  };
}

function contextFromPatch(patch: OrderPatch): TemplateContext {
  const total =
    patch.totalPrice && patch.currency
      ? `${patch.totalPrice} ${patch.currency}`
      : (patch.totalPrice ?? null);
  return {
    customer_first_name: patch.customerFirstName ?? null,
    customer_name: patch.customerFirstName ?? null,
    order_name: patch.orderName ?? null,
    order_total: total,
    order_status_url: patch.orderStatusUrl ?? null,
  };
}
