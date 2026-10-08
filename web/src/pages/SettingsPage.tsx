import { useEffect, useState } from "react";
import { loadSettings, saveSettings } from "../api";
import {
  EVENT_LABELS,
  EVENT_TYPES,
  TEMPLATE_VARIABLES,
  type EventType,
  type ShopSettings,
} from "../types";

export function SettingsPage() {
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSettings()
      .then((result) => {
        if (!cancelled) setSettings(result.settings);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load settings");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!settings) return <p>{error ?? "Loading settings…"}</p>;

  function toggle(list: "smsEvents" | "voiceEvents", event: EventType, checked: boolean) {
    setSettings((current) => {
      if (!current) return current;
      const next = new Set(current[list]);
      if (checked) next.add(event);
      else next.delete(event);
      return { ...current, [list]: EVENT_TYPES.filter((item) => next.has(item)) };
    });
  }

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        setError(null);
        setStatus(null);
        saveSettings(settings)
          .then((result) => {
            setSettings(result.settings);
            setStatus("Saved");
          })
          .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not save"))
          .finally(() => setSaving(false));
      }}
    >
      <div>
        <h2>Notification settings</h2>
        <p className="muted">
          Choose which order events send an SMS, a voice call, or both. Templates can use{" "}
          {TEMPLATE_VARIABLES.map((name) => `{{${name}}}`).join(", ")}.
        </p>
      </div>
      {EVENT_TYPES.map((event) => (
        <div className="card grid" key={event}>
          <strong>{EVENT_LABELS[event]}</strong>
          <label className="field">
            Message
            <textarea
              value={settings.templates[event]}
              onChange={(change) =>
                setSettings({
                  ...settings,
                  templates: { ...settings.templates, [event]: change.target.value },
                })
              }
            />
          </label>
          <label className="checks">
            <input
              type="checkbox"
              checked={settings.smsEvents.includes(event)}
              onChange={(change) => toggle("smsEvents", event, change.target.checked)}
            />
            SMS
          </label>
          <label className="checks">
            <input
              type="checkbox"
              checked={settings.voiceEvents.includes(event)}
              onChange={(change) => toggle("voiceEvents", event, change.target.checked)}
            />
            Voice
          </label>
        </div>
      ))}
      <div className="panel stack">
        <label className="checks">
          <input
            type="checkbox"
            checked={settings.quietHoursEnabled}
            onChange={(change) =>
              setSettings({ ...settings, quietHoursEnabled: change.target.checked })
            }
          />
          Hold texts and calls during quiet hours
        </label>
        <div className="row">
          <label className="field">
            Quiet hours start
            <input
              type="time"
              value={settings.quietHoursStart}
              onChange={(change) =>
                setSettings({ ...settings, quietHoursStart: change.target.value })
              }
            />
          </label>
          <label className="field">
            Quiet hours end
            <input
              type="time"
              value={settings.quietHoursEnd}
              onChange={(change) =>
                setSettings({ ...settings, quietHoursEnd: change.target.value })
              }
            />
          </label>
          <label className="field">
            Time zone
            <input
              type="text"
              value={settings.quietHoursTimezone}
              onChange={(change) =>
                setSettings({ ...settings, quietHoursTimezone: change.target.value })
              }
            />
          </label>
          <label className="field">
            Stalled after days
            <input
              type="number"
              min={1}
              max={30}
              value={settings.stalledAfterDays}
              onChange={(change) =>
                setSettings({ ...settings, stalledAfterDays: Number(change.target.value) })
              }
            />
          </label>
        </div>
        <label className="field">
          STOP reply
          <textarea
            value={settings.optOutMessage}
            onChange={(change) => setSettings({ ...settings, optOutMessage: change.target.value })}
          />
        </label>
        <label className="field">
          HELP reply
          <textarea
            value={settings.helpMessage}
            onChange={(change) => setSettings({ ...settings, helpMessage: change.target.value })}
          />
        </label>
        <label className="field">
          STATUS reply
          <textarea
            value={settings.statusTemplate}
            onChange={(change) => setSettings({ ...settings, statusTemplate: change.target.value })}
          />
        </label>
      </div>
      <div className="actions">
        <button className="button" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
        {status ? <span>{status}</span> : null}
        {error ? <span>{error}</span> : null}
      </div>
    </form>
  );
}
