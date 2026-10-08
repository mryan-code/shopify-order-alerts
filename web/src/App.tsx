import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { ApiError, loadShop } from "./api";
import { ConversationsPage } from "./pages/ConversationsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ThreadPage } from "./pages/ThreadPage";

export function App() {
  const location = useLocation();
  const suffix = location.search;
  const [shopName, setShopName] = useState("Order Alerts");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadShop()
      .then((shop) => {
        if (cancelled) return;
        setShopName(shop.name);
        setNotice(
          shop.devAdmin
            ? "Local development admin is on. Data is stored for dev-shop.myshopify.com."
            : null,
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          setNotice("Open this app from the Shopify admin so it can use your shop session.");
          return;
        }
        setNotice(error instanceof Error ? error.message : "Could not load the shop");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <h1>Order Alerts</h1>
          <p>{shopName}</p>
        </div>
        <nav className="nav">
          <NavLink to={`/${suffix}`} end>
            Conversations
          </NavLink>
          <NavLink to={`/settings${suffix}`}>Settings</NavLink>
        </nav>
      </header>
      {notice ? <div className="banner">{notice}</div> : null}
      <Routes>
        <Route path="/" element={<ConversationsPage />} />
        <Route path="/orders/:orderId" element={<ThreadPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </div>
  );
}
