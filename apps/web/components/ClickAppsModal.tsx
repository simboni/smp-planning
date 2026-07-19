"use client";

/**
 * Module 14 — the ClickApps modal. Loads a space's feature toggles from
 * `GET /spaces/:id/clickapps` and PUTs the whole map on every change
 * (optimistic, reverts on error). Space managers only — the caller gates
 * on myPermission === 'full'.
 */

import { useEffect, useState } from "react";
import {
  clickappsApi,
  CLICKAPP_META,
  type SpaceClickApps,
} from "@/lib/api";
import { Icons } from "@/components/icons";

export function ClickAppsModal({
  spaceId,
  spaceName,
  onClose,
}: {
  spaceId: string;
  spaceName: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<SpaceClickApps | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    clickappsApi
      .get(spaceId)
      .then((r) => {
        if (live) setState(r.clickapps);
      })
      .catch(() => {
        if (live) setError("Couldn't load ClickApps for this space.");
      });
    return () => {
      live = false;
    };
  }, [spaceId]);

  const flip = (key: keyof SpaceClickApps): void => {
    if (!state) return;
    const next = { ...state, [key]: !state[key] };
    const prev = state;
    setState(next);
    setSaving(true);
    clickappsApi
      .update(spaceId, next)
      .then((r) => setState(r.clickapps))
      .catch(() => {
        setState(prev); // revert
        setError("Couldn't save that change.");
      })
      .finally(() => setSaving(false));
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal ca-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-body">
            <h3>{Icons.sliders} ClickApps</h3>
            <p className="muted">
              Turn features on or off for <strong>{spaceName}</strong>.
            </p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="ca-list">
          {state === null && !error ? (
            <>
              <span className="skel" style={{ height: 54, borderRadius: 10, marginBottom: 8 }} />
              <span className="skel" style={{ height: 54, borderRadius: 10, marginBottom: 8 }} />
              <span className="skel" style={{ height: 54, borderRadius: 10 }} />
            </>
          ) : (
            state &&
            CLICKAPP_META.map((m) => {
              const on = state[m.key];
              return (
                <div key={m.key} className={`ca-row${on ? " on" : ""}`}>
                  <span className="ca-row-body">
                    <span className="ca-row-label">{m.label}</span>
                    <span className="ca-row-desc">{m.desc}</span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`${m.label} — ${on ? "on" : "off"}`}
                    className={`switch${on ? " on" : ""}`}
                    onClick={() => flip(m.key)}
                  />
                </div>
              );
            })
          )}
        </div>

        <div className="ca-foot">
          <span className="muted">{saving ? "Saving…" : "Changes save automatically."}</span>
          <button type="button" className="btn btn-soft btn-sm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
