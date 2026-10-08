import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { loadThread } from "../api";
import type { OrderDetails, ThreadMessage } from "../types";

export function ThreadPage() {
  const params = useParams();
  const location = useLocation();
  const orderId = params.orderId ?? "";
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadThread(orderId)
      .then((result) => {
        if (cancelled) return;
        setOrder(result.order);
        setMessages(result.messages);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this thread");
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  return (
    <section className="stack">
      <Link to={`/${location.search}`}>Back to conversations</Link>
      {error ? <div className="banner error">{error}</div> : null}
      {order ? (
        <div className="panel">
          <h2>{order.orderName}</h2>
          <p className="muted">
            {order.customerFirstName ?? "Customer"}
            {order.customerPhone ? ` · ${order.customerPhone}` : ""} · {order.statusSummary}
          </p>
          {order.trackingNumber ? (
            <p>
              {order.trackingCompany ?? "Carrier"} {order.trackingNumber}
              {order.trackingUrl ? (
                <>
                  {" "}
                  <a href={order.trackingUrl}>Track</a>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="thread">
        {messages.map((message) => (
          <article key={message.id} className={`bubble ${message.direction}`}>
            <div className="meta">
              <span className="pill">{message.direction === "inbound" ? "Customer" : "Shop"}</span>
              <span className="pill">{message.channel}</span>
              <span className="pill">{message.status}</span>
              <span>{new Date(message.createdAt).toLocaleString()}</span>
            </div>
            <div>{message.body}</div>
          </article>
        ))}
      </div>
    </section>
  );
}
