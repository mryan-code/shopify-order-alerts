import "@shopify/ui-extensions/admin.order-details.block.render";
import type { Api } from "@shopify/ui-extensions/admin.order-details.block.render";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

declare global {
  const shopify: Api;
}

interface ThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  channel: "sms" | "voice";
  body: string;
  status: string;
  createdAt: string;
}

export default async function extension(): Promise<void> {
  render(<OrderSmsBlock />, document.body);
}

function OrderSmsBlock() {
  const orderId = shopify.data.selected[0]?.id ?? "";
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      if (!orderId) {
        setMessages([]);
        return;
      }
      try {
        const token = await shopify.auth.idToken();
        const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/thread`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (response.status === 404) {
          if (!cancelled) setMessages([]);
          return;
        }
        if (!response.ok) throw new Error("Could not load the SMS thread");
        const json = (await response.json()) as { messages: ThreadMessage[] };
        if (!cancelled) setMessages(json.messages);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Could not load the SMS thread");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  return (
    <s-admin-block heading="Order alerts">
      {error ? <s-banner tone="critical">{error}</s-banner> : null}
      {messages === null && !error ? <s-text>Loading the SMS thread.</s-text> : null}
      {messages && messages.length === 0 ? <s-text>No texts yet for this order.</s-text> : null}
      <s-stack gap="base">
        {messages?.map((message) => (
          <s-stack key={message.id} gap="small-100">
            <s-text type="strong">
              {message.direction === "inbound" ? "Customer" : "Shop"} · {message.channel} ·{" "}
              {message.status}
            </s-text>
            <s-text>{message.body}</s-text>
          </s-stack>
        ))}
      </s-stack>
    </s-admin-block>
  );
}
