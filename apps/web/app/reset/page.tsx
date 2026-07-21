"use client";

/**
 * Password reset page (`/reset?token=…`). Standalone (no AppShell / auth
 * guard): the emailed link lands here, the user sets a new password, and on
 * success we bounce to /login. The token is validated server-side.
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, authApi } from "@/lib/api";
import { Icons, StackMark } from "@/components/icons";

const MIN = 8;

function ResetView() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (password.length < MIN) {
      setError(`Password must be at least ${MIN} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
      setTimeout(() => router.replace("/login"), 2200);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again.",
      );
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <main className="auth-formside" style={{ margin: "0 auto" }}>
        <div className="auth-card">
          <div className="auth-card-logo">
            <div className="brand">
              <span className="brand-mark">
                <StackMark />
              </span>
              <span className="brand-name">
                Stack<span className="up">Up</span>
              </span>
            </div>
          </div>

          {!token ? (
            <>
              <h1 className="auth-title">Invalid reset link</h1>
              <p className="auth-sub">
                This link is missing its token. Request a new one from the login
                page.
              </p>
              <Link href="/login" className="btn btn-primary btn-lg btn-block" style={{ marginTop: 8 }}>
                Back to log in
              </Link>
            </>
          ) : done ? (
            <>
              <h1 className="auth-title">Password updated</h1>
              <p className="auth-sub">
                Your password has been changed. Taking you to the login page…
              </p>
              <Link href="/login" className="btn btn-primary btn-lg btn-block" style={{ marginTop: 8 }}>
                Log in now
              </Link>
            </>
          ) : (
            <>
              <h1 className="auth-title">Set a new password</h1>
              <p className="auth-sub">Choose a strong password for your account.</p>
              <form onSubmit={(e) => void submit(e)}>
                {error && <div className="form-error">{error}</div>}
                <div className="field">
                  <label className="label" htmlFor="new-pw">New password</label>
                  <div className="input-affix">
                    <input
                      id="new-pw"
                      className="input"
                      type={showPw ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      minLength={MIN}
                      autoComplete="new-password"
                      autoFocus
                      required
                    />
                    <button
                      type="button"
                      className={`pw-toggle${showPw ? " on" : ""}`}
                      aria-label={showPw ? "Hide password" : "Show password"}
                      onClick={() => setShowPw((v) => !v)}
                    >
                      {Icons.eye}
                    </button>
                  </div>
                </div>
                <div className="field">
                  <label className="label" htmlFor="confirm-pw">Confirm password</label>
                  <input
                    id="confirm-pw"
                    className="input"
                    type={showPw ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Re-enter your password"
                    minLength={MIN}
                    autoComplete="new-password"
                    required
                  />
                </div>
                <button
                  className="btn btn-primary btn-lg btn-block"
                  type="submit"
                  disabled={busy}
                  style={{ marginTop: 8 }}
                >
                  {busy ? <span className="spinner" /> : "Update password"}
                </button>
              </form>
              <p className="auth-alt">
                <Link href="/login">Back to log in</Link>
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={null}>
      <ResetView />
    </Suspense>
  );
}
