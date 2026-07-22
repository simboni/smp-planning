"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  securityApi,
  type SessionInfo,
} from "@/lib/api";
import { Icons } from "@/components/icons";

/* ------------------------------------------------------------------ *
 * Module 16 — Account security (2FA + active sessions).
 * Two cards, each self-contained: a two-factor enroll/enable/disable
 * flow and a live list of the account's sessions.
 * ------------------------------------------------------------------ */

export default function SecuritySettings() {
  return (
    <>
      <TwoFactorCard />
      <SessionsCard />
    </>
  );
}

/* ---- Two-factor authentication ------------------------------------ */

type TwoFAView = "loading" | "off" | "enrolling" | "on";

function TwoFactorCard() {
  const [view, setView] = useState<TwoFAView>("loading");
  const [qr, setQr] = useState<{ otpauthUri: string; qrDataUrl: string } | null>(
    null,
  );
  const [code, setCode] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    securityApi
      .twoFactorStatus()
      .then((r) => setView(r.enabled ? "on" : "off"))
      .catch(() => setView("off"));
  }, []);

  const clean = (v: string) => v.replace(/\D/g, "").slice(0, 6);

  const startEnroll = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await securityApi.enroll2fa();
      setQr(r);
      setCode("");
      setView("enrolling");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start setup.");
    } finally {
      setBusy(false);
    }
  };

  const enable = async () => {
    if (code.length < 6) return;
    setBusy(true);
    setError("");
    try {
      await securityApi.enable2fa(code);
      setQr(null);
      setCode("");
      setView("on");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "That code didn't work.",
      );
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (code.length < 6) return;
    setBusy(true);
    setError("");
    try {
      await securityApi.disable2fa(code);
      setCode("");
      setDisabling(false);
      setView("off");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "That code didn't work.",
      );
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setQr(null);
    setCode("");
    setDisabling(false);
    setError("");
    setView(view === "enrolling" ? "off" : "on");
  };

  return (
    <div className="card intg-card">
      <div className="card-head">
        <h3>
          <span className="intg-ic">{Icons.lock}</span> Two-factor authentication
        </h3>
        {view === "on" && (
          <span className="badge sec-badge-on">
            {Icons.check} Enabled
          </span>
        )}
      </div>
      <p className="intg-desc">
        Add a second step to sign-in using a time-based code from an
        authenticator app (Google Authenticator, 1Password, Authy…).
      </p>

      {error && <div className="sec-error">{error}</div>}

      {view === "loading" && <div className="skel" style={{ height: 40 }} />}

      {view === "off" && (
        <button className="btn btn-primary" onClick={startEnroll} disabled={busy}>
          {busy ? <span className="spinner" /> : <>{Icons.lock} Enable two-factor</>}
        </button>
      )}

      {view === "enrolling" && qr && (
        <div className="sec-enroll">
          <div className="sec-qr">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr.qrDataUrl} alt="Two-factor QR code" width={168} height={168} />
          </div>
          <div className="sec-enroll-body">
            <ol className="sec-steps">
              <li>Open your authenticator app and scan this QR code.</li>
              <li>Enter the 6-digit code it shows to confirm.</li>
            </ol>
            <div className="field" style={{ marginBottom: 10 }}>
              <label className="label" htmlFor="sec-enroll-code">
                Verification code
              </label>
              <input
                id="sec-enroll-code"
                className="input auth-2fa-code"
                value={code}
                onChange={(e) => setCode(clean(e.target.value))}
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
              />
            </div>
            <div className="sec-actions">
              <button
                className="btn btn-primary"
                onClick={enable}
                disabled={busy || code.length < 6}
              >
                {busy ? <span className="spinner" /> : "Verify & enable"}
              </button>
              <button className="btn btn-ghost" onClick={cancel} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {view === "on" && !disabling && (
        <button className="btn btn-ghost sec-danger" onClick={() => setDisabling(true)}>
          Turn off
        </button>
      )}

      {view === "on" && disabling && (
        <div className="sec-disable">
          <div className="field" style={{ marginBottom: 10 }}>
            <label className="label" htmlFor="sec-disable-code">
              Enter a current code to turn off two-factor
            </label>
            <input
              id="sec-disable-code"
              className="input auth-2fa-code"
              value={code}
              onChange={(e) => setCode(clean(e.target.value))}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
            />
          </div>
          <div className="sec-actions">
            <button
              className="btn btn-ghost sec-danger"
              onClick={disable}
              disabled={busy || code.length < 6}
            >
              {busy ? <span className="spinner" /> : "Turn off two-factor"}
            </button>
            <button className="btn btn-ghost" onClick={cancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- Active sessions ---------------------------------------------- */

function SessionsCard() {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  // Keep the session log collapsed by default — it's a rarely-needed audit
  // list, so it shouldn't crowd the Security page until the user asks for it.
  const [open, setOpen] = useState(false);

  const load = () =>
    securityApi
      .listSessions()
      .then((r) => setSessions(r.sessions))
      .catch(() => setSessions([]));

  // Load lazily the first time the card is expanded.
  useEffect(() => {
    if (open && sessions === null) load();
  }, [open, sessions]);

  const revoke = async (id: string) => {
    setRevoking(id);
    try {
      await securityApi.revokeSession(id);
      await load();
    } finally {
      setRevoking(null);
    }
  };

  const count = sessions?.length ?? null;

  return (
    <div className="card intg-card">
      <button
        type="button"
        className="card-head sec-collapse-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <h3>
          <span className="intg-ic">{Icons.globe}</span> Active sessions
          {count !== null && <span className="sec-count">{count}</span>}
        </h3>
        <span className={`sec-chevron${open ? " open" : ""}`}>{Icons.chevronDown}</span>
      </button>

      {open && (
        <>
          <p className="intg-desc">
            Devices signed in to your account. Sign out any you don&apos;t recognize.
          </p>

          <div className="intg-list">
            {sessions === null && <div className="skel" style={{ height: 40 }} />}
            {sessions?.length === 0 && (
              <div className="intg-empty">No active sessions.</div>
            )}
            {sessions?.map((s) => (
              <div key={s.id} className="intg-row">
                <div>
                  <div className="intg-row-title">
                    {deviceLabel(s.userAgent)}
                    {s.current && (
                      <span className="badge sec-badge-current">This device</span>
                    )}
                  </div>
                  <div className="intg-row-sub">
                    <span>{lastUsedLabel(s)}</span>
                  </div>
                </div>
                {!s.current && (
                  <button
                    className="btn btn-ghost intg-danger"
                    onClick={() => revoke(s.id)}
                    disabled={revoking === s.id}
                    title="Sign out"
                  >
                    {Icons.signout} Sign out
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Best-effort helpers.
 * ------------------------------------------------------------------ */

/** Turn a raw User-Agent into a friendly "Browser on OS" label. */
function deviceLabel(ua: string | null): string {
  if (!ua) return "Unknown device";

  let os = "";
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/CrOS/i.test(ua)) os = "ChromeOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return os;
  return ua;
}

/** "Active now / last used …, created …" line for a session. */
function lastUsedLabel(s: SessionInfo): string {
  const used = s.lastUsedAt
    ? `Last active ${new Date(s.lastUsedAt).toLocaleString()}`
    : null;
  const created = `Signed in ${new Date(s.createdAt).toLocaleDateString()}`;
  return used ? `${used} · ${created}` : created;
}
