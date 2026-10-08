import { describe, expect, it, vi } from "vitest";
import { adminGraphql, fetchStalledOrders } from "../src/shopify/orders.js";

describe("adminGraphql", () => {
  it("posts the query with the offline access token", async () => {
    const fetchImpl = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
        return new Response(JSON.stringify({ data: { shop: { name: "Demo" } } }), { status: 200 });
      },
    );
    const data = await adminGraphql<{ shop: { name: string } }>({
      shop: "demo.myshopify.com",
      version: "2026-01",
      token: "test-offline-token",
      query: "query { shop { name } }",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(data.shop.name).toBe("Demo");
    const firstCall = fetchImpl.mock.calls[0];
    const url = String(firstCall?.[0]);
    const init = firstCall?.[1];
    expect(url).toBe("https://demo.myshopify.com/admin/api/2026-01/graphql.json");
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get("X-Shopify-Access-Token")).toBe("test-offline-token");
  });

  it("raises GraphQL errors", async () => {
    const fetchImpl = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
        new Response(JSON.stringify({ errors: [{ message: "nope" }] }), { status: 200 }),
    );
    await expect(
      adminGraphql({
        shop: "demo.myshopify.com",
        version: "2026-01",
        token: "test-offline-token",
        query: "query { shop { name } }",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/nope/);
  });
});

describe("fetchStalledOrders", () => {
  it("keeps paid unfulfilled orders older than the cutoff", async () => {
    const graphql = vi.fn(async (_query: string, _variables?: Record<string, unknown>) => ({
      orders: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          {
            id: "gid://shopify/Order/1001",
            name: "#1001",
            createdAt: "2026-01-01T00:00:00Z",
            cancelledAt: null,
            displayFinancialStatus: "PAID",
            displayFulfillmentStatus: "UNFULFILLED",
            phone: null,
            email: "ada@example.com",
            customer: { id: "gid://shopify/Customer/9", firstName: "Ada", phone: "+14155552671" },
            shippingAddress: { phone: "+14155552671", firstName: "Ada" },
            currentTotalPriceSet: { shopMoney: { amount: "24.00", currencyCode: "USD" } },
            statusPageUrl: "https://shop.example/1001",
          },
          {
            id: "gid://shopify/Order/1002",
            name: "#1002",
            createdAt: "2026-01-10T00:00:00Z",
            cancelledAt: null,
            displayFinancialStatus: "PAID",
            displayFulfillmentStatus: "FULFILLED",
            phone: null,
            email: null,
            customer: null,
            shippingAddress: null,
            currentTotalPriceSet: null,
          },
        ],
      },
    }));
    const intents = await fetchStalledOrders(
      graphql as unknown as Parameters<typeof fetchStalledOrders>[0],
      new Date("2026-01-08T00:00:00Z"),
    );
    expect(intents).toHaveLength(1);
    expect(intents[0]?.patch.shopifyOrderId).toBe("1001");
    expect(intents[0]?.event).toBe("order_stalled");
    const variables = graphql.mock.calls[0]?.[1] as { query: string } | undefined;
    expect(variables?.query).toContain("fulfillment_status:unfulfilled");
  });
});
