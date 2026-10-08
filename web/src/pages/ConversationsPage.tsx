import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ApiError, loadConversations } from "../api";
import type { Conversation } from "../types";

export function ConversationsPage() {
  const location = useLocation();
  const [rows, setRows] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shop, setShop] = useState("example.myshopify.com");

  useEffect(() => {
    let cancelled = false;
    loadConversations()
      .then((result) => {
        if (!cancelled) setRows(result.conversations);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load conversations");
        setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="stack">
      <div>
        <h2>Conversations</h2>
        <p className="muted">
          Texts and calls are grouped by order. Open a row to read the thread.
        </p>
      </div>
      {error ? (
        <form
          className="panel stack"
          onSubmit={(event) => {
            event.preventDefault();
            const domain = shop.trim().toLowerCase();
            window.location.assign(`/auth?shop=${encodeURIComponent(domain)}`);
          }}
        >
          <strong>Install on a store</strong>
          <label className="field">
            Shop domain
            <input value={shop} onChange={(event) => setShop(event.target.value)} />
          </label>
          <button className="button" type="submit">
            Continue with Shopify
          </button>
          <p className="muted">{error}</p>
        </form>
      ) : null}
      {rows === null ? <p>Loading conversations…</p> : null}
      {rows && rows.length === 0 && !error ? (
        <div className="panel">
          No order texts yet. Paid, shipped, delivered, cancelled, refunded, and stalled orders will
          show up here.
        </div>
      ) : null}
      <div className="list">
        {rows?.map((row) => (
          <Link
            key={row.shopifyOrderId}
            className="card conversation"
            to={`/orders/${encodeURIComponent(row.shopifyOrderId)}${location.search}`}
          >
            <div>
              <strong>{row.orderName}</strong>
              <span className="muted">
                {row.customerFirstName ?? "Customer"}{" "}
                {row.customerPhone ? `· ${row.customerPhone}` : ""}
              </span>
            </div>
            <div>{row.lastMessage ?? "No messages yet"}</div>
            <div className="muted">{row.statusSummary}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
