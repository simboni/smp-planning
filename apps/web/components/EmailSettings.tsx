"use client";

import { useEffect, useState } from "react";
import { authApi, type EmailNotify, type EmailPreferences } from "@/lib/api";
import { showToast } from "@/lib/toast";

const OPTIONS: { value: EmailNotify; label: string; hint: string }[] = [
  {
    value: "instant",
    label: "As it happens",
    hint: "An email when someone assigns you a task or a comment, or @mentions you — a few at once arrive together.",
  },
  {
    value: "digest",
    label: "Daily summary",
    hint: "One email each morning (7:00 Nairobi time) with everything since the last one.",
  },
  {
    value: "off",
    label: "Off",
    hint: "No notification emails. Your inbox in StackUp still has everything.",
  },
];

/**
 * Notification emails. Reminders you set arrive on time with "As it happens"
 * and "Daily summary"; invites and password resets are always sent.
 */
export default function EmailSettings() {
  const [prefs, setPrefs] = useState<EmailPreferences | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    authApi
      .emailPreferences()
      .then(setPrefs)
      .catch(() => undefined);
  }, []);

  const choose = async (value: EmailNotify): Promise<void> => {
    if (!prefs || busy || value === prefs.emailNotify) return;
    const previous = prefs;
    setPrefs({ ...prefs, emailNotify: value });
    setBusy(true);
    try {
      setPrefs(await authApi.setEmailPreferences(value));
      showToast("Email settings saved.");
    } catch {
      setPrefs(previous);
      showToast("Couldn't save your email settings.");
    } finally {
      setBusy(false);
    }
  };

  const current = OPTIONS.find((o) => o.value === prefs?.emailNotify);

  return (
    <div className="card" id="email" style={{ marginBottom: 20 }}>
      <div className="card-head">
        <h3>Email notifications</h3>
      </div>
      <div className="setting-row">
        <div style={{ minWidth: 0 }}>
          <div className="setting-label">Assignments and @mentions</div>
          <div className="setting-hint">
            {current?.hint ?? "How StackUp emails you about work that needs you."}
          </div>
        </div>
        <div role="radiogroup" aria-label="Notification emails" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={prefs?.emailNotify === o.value}
              className={`chip${prefs?.emailNotify === o.value ? " active" : ""}`}
              disabled={!prefs || busy}
              onClick={() => void choose(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="setting-row">
        <div>
          <div className="setting-label">Reminders</div>
          <div className="setting-hint">
            {prefs?.emailNotify === "off"
              ? "Off with the setting above — reminders show in your inbox only."
              : "Emailed when they come due, even with the daily summary."}
          </div>
        </div>
      </div>
      {prefs && !prefs.deliveryConfigured && (
        <div className="notice" style={{ marginTop: 4 }}>
          Email isn&apos;t set up on this server yet, so nothing is being sent.
        </div>
      )}
    </div>
  );
}
