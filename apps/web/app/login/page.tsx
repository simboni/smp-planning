"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  API_BASE,
  ApiError,
  authApi,
  clearTokens,
  getIdentityToken,
  googleSsoStartUrl,
  isTwoFactorChallenge,
  setIdentityToken,
  setRefreshToken,
  setUser,
  type PublicUser,
} from "@/lib/api";
import { Icons, StackMark, GoogleMark } from "@/components/icons";
import { initDeepLinks, isNativeApp } from "@/lib/native";

type Mode = "login" | "signup" | "forgot";
type Health = "checking" | "ok" | "down";

const FEATURES: { icon: keyof typeof Icons; label: string; desc: string }[] = [
  { icon: "tasks", label: "Tasks", desc: "Plan work across lists, boards & calendars" },
  { icon: "docs", label: "Docs", desc: "Write and collaborate in real time" },
  { icon: "goals", label: "Goals", desc: "Track targets that roll up automatically" },
  { icon: "dashboards", label: "Dashboards", desc: "See progress at a glance" },
];

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [health, setHealth] = useState<Health>("checking");
  const [healthMsg, setHealthMsg] = useState("");
  // Second-factor step: set to the challenge token once login says 2FA is on.
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  // Whether Google SSO is configured (drives the button); and a busy flag
  // while we finish an SSO redirect.
  const [googleSso, setGoogleSso] = useState(false);
  const [ssoBusy, setSsoBusy] = useState(false);

  // Finish a Google SSO redirect: the callback bounced back with tokens in the
  // URL fragment (kept out of server logs). Store them, load the user, go on.
  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const err = params.get("sso_error");
    if (err) {
      setError(err);
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }
    const identityToken = params.get("identityToken");
    const refreshToken = params.get("refreshToken");
    if (identityToken && refreshToken) {
      setSsoBusy(true);
      window.history.replaceState(null, "", window.location.pathname);
      clearTokens();
      setIdentityToken(identityToken);
      setRefreshToken(refreshToken);
      authApi
        .me()
        .then((r) => setUser(r.user))
        .catch(() => undefined)
        .finally(() => router.replace("/select"));
    }
  }, [router]);

  // Already have an identity? Skip straight to workspace selection. (Guarded
  // so it doesn't race the SSO-fragment handler above on the same load.)
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash) return;
    if (getIdentityToken()) router.replace("/select");
  }, [router]);

  // Native shell: the Google SSO callback arrives as a custom-scheme deep
  // link while the user is still on this page — listen for it here.
  useEffect(() => {
    if (isNativeApp()) void initDeepLinks();
  }, []);

  // Is Google SSO available? Hide the button entirely when it isn't.
  useEffect(() => {
    authApi
      .ssoProviders()
      .then((r) => setGoogleSso(r.google))
      .catch(() => setGoogleSso(false));
  }, []);

  // Lightweight backend heartbeat for the status chip. Reflects the DATABASE
  // status (db), not just that the server answered — a reachable API with a
  // broken DB is exactly what blocks signup/login, so surface it here.
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/health`)
      .then((r) => r.json().catch(() => ({})))
      .then((b: { status?: string; db?: boolean; dbError?: string }) => {
        if (!alive) return;
        if (b.db) {
          setHealth("ok");
        } else {
          setHealth("down");
          setHealthMsg(b.dbError || "Database unavailable");
        }
      })
      .catch(() => {
        if (alive) setHealth("down");
      });
    return () => {
      alive = false;
    };
  }, []);

  // Store tokens and head to workspace selection — the shared "logged in" path.
  const finishAuth = (result: {
    identityToken: string;
    refreshToken: string;
    user: PublicUser;
  }): void => {
    setIdentityToken(result.identityToken);
    setRefreshToken(result.refreshToken);
    setUser(result.user);
    // Whether they have workspaces or not, /select handles both (list or
    // "create your first workspace").
    router.replace("/select");
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      clearTokens();
      if (mode === "signup") {
        finishAuth(
          await authApi.signup({
            fullName: fullName.trim(),
            email: email.trim(),
            password,
          }),
        );
        return;
      }

      const result = await authApi.login({ email: email.trim(), password });
      // Account has 2FA on — swap the form for the code step and hold the token.
      if (isTwoFactorChallenge(result)) {
        setChallengeToken(result.challengeToken);
        setCode("");
        setBusy(false);
        return;
      }
      finishAuth(result);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again.",
      );
      setBusy(false);
    }
  };

  // Second step: exchange the challenge token + authenticator code for tokens.
  const submit2fa = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy || !challengeToken) return;
    setBusy(true);
    setError("");
    try {
      finishAuth(await authApi.login2fa(challengeToken, code.trim()));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again.",
      );
      setBusy(false);
    }
  };

  const cancel2fa = (): void => {
    setChallengeToken(null);
    setCode("");
    setError("");
    setBusy(false);
  };

  const switchMode = (m: Mode): void => {
    setMode(m);
    setError("");
    setForgotSent(false);
  };

  const submitForgot = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await authApi.forgotPassword(email.trim());
      setForgotSent(true);
    } catch (err) {
      // The endpoint never fails on unknown emails; only surface real errors.
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      {/* ---- brand panel (wide screens) ---- */}
      <aside className="auth-brandside">
        <div className="auth-brand-logo">
          <span className="brand-mark">
            <StackMark />
          </span>
          StackUp
        </div>

        <div className="auth-brand-body">
          <h2>One app to plan, track, and get work done.</h2>
          <p>
            Bring your tasks, docs, goals and dashboards together in a single,
            beautifully organized workspace your whole team will love.
          </p>
          <div className="auth-features">
            {FEATURES.map((f) => (
              <div className="auth-feature" key={f.label}>
                <span className="auth-feature-ic">{Icons[f.icon]}</span>
                <div>
                  <div>{f.label}</div>
                  <div style={{ fontWeight: 400, fontSize: "0.82rem", opacity: 0.85 }}>
                    {f.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="auth-brand-foot">
          Trusted by teams to organize everything, from daily tasks to big goals.
        </div>
      </aside>

      {/* ---- form panel ---- */}
      <main className="auth-formside">
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

          {challengeToken ? (
            <>
              <h1 className="auth-title">Two-factor authentication</h1>
              <p className="auth-sub">
                Enter the code from your authenticator app to finish signing in.
              </p>

              <form onSubmit={(e) => void submit2fa(e)}>
                {error && <div className="form-error">{error}</div>}

                <div className="field">
                  <label className="label" htmlFor="twofa-code">
                    Authentication code
                  </label>
                  <input
                    id="twofa-code"
                    className="input auth-2fa-code"
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    placeholder="000000"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    required
                  />
                </div>

                <button
                  className="btn btn-primary btn-lg btn-block"
                  type="submit"
                  disabled={busy || code.length < 6}
                  style={{ marginTop: 8 }}
                >
                  {busy ? <span className="spinner" /> : "Verify"}
                </button>
              </form>

              <p className="auth-alt">
                <button type="button" onClick={cancel2fa}>
                  Back to log in
                </button>
              </p>
            </>
          ) : mode === "forgot" ? (
            <>
              <h1 className="auth-title">Reset your password</h1>
              {forgotSent ? (
                <>
                  <p className="auth-sub">
                    If an account exists for <strong>{email.trim()}</strong>,
                    we've sent a link to reset your password. Check your inbox
                    (and spam) — the link expires in 1 hour.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary btn-lg btn-block"
                    style={{ marginTop: 8 }}
                    onClick={() => switchMode("login")}
                  >
                    Back to log in
                  </button>
                </>
              ) : (
                <>
                  <p className="auth-sub">
                    Enter your email and we'll send you a link to set a new
                    password.
                  </p>
                  <form onSubmit={(e) => void submitForgot(e)}>
                    {error && <div className="form-error">{error}</div>}
                    <div className="field">
                      <label className="label" htmlFor="forgot-email">
                        Email
                      </label>
                      <input
                        id="forgot-email"
                        className="input"
                        type="email"
                        inputMode="email"
                        autoCapitalize="none"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@company.com"
                        autoFocus
                        required
                      />
                    </div>
                    <button
                      className="btn btn-primary btn-lg btn-block"
                      type="submit"
                      disabled={busy}
                      style={{ marginTop: 8 }}
                    >
                      {busy ? <span className="spinner" /> : "Send reset link"}
                    </button>
                  </form>
                  <p className="auth-alt">
                    <button type="button" onClick={() => switchMode("login")}>
                      Back to log in
                    </button>
                  </p>
                </>
              )}
            </>
          ) : (
          <>
          <div className="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={`tab${mode === "login" ? " active" : ""}`}
              onClick={() => switchMode("login")}
            >
              Log in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signup"}
              className={`tab${mode === "signup" ? " active" : ""}`}
              onClick={() => switchMode("signup")}
            >
              Sign up
            </button>
          </div>

          <h1 className="auth-title">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="auth-sub">
            {mode === "login"
              ? "Log in to continue to your workspaces."
              : "Start planning with your team in minutes."}
          </p>

          <form onSubmit={(e) => void submit(e)}>
            {error && <div className="form-error">{error}</div>}

            {mode === "signup" && (
              <div className="field">
                <label className="label" htmlFor="fullName">
                  Full name
                </label>
                <input
                  id="fullName"
                  className="input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ada Lovelace"
                  autoComplete="name"
                  required
                />
              </div>
            )}

            <div className="field">
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                className="input"
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="password">
                Password
              </label>
              <div className="input-affix">
                <input
                  id="password"
                  className="input"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
                  minLength={mode === "signup" ? 8 : undefined}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
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
              {mode === "login" && (
                <button
                  type="button"
                  className="auth-forgot-link"
                  onClick={() => switchMode("forgot")}
                >
                  Forgot password?
                </button>
              )}
            </div>

            <button
              className="btn btn-primary btn-lg btn-block"
              type="submit"
              disabled={busy}
              style={{ marginTop: 8 }}
            >
              {busy ? (
                <span className="spinner" />
              ) : mode === "login" ? (
                "Log in"
              ) : (
                "Create account"
              )}
            </button>
          </form>

          <p className="auth-alt">
            {mode === "login" ? (
              <>
                New to StackUp?{" "}
                <button type="button" onClick={() => switchMode("signup")}>
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button type="button" onClick={() => switchMode("login")}>
                  Log in
                </button>
              </>
            )}
          </p>

          {googleSso && (
            <>
              <div className="auth-or">
                <span>or</span>
              </div>
              <button
                type="button"
                className="btn btn-social btn-lg btn-block"
                disabled={busy || ssoBusy}
                onClick={() => {
                  setSsoBusy(true);
                  // Native: the API carries the flag through the OAuth state
                  // and bounces the callback to a custom-scheme deep link.
                  window.location.href = isNativeApp()
                    ? `${googleSsoStartUrl}?native=1`
                    : googleSsoStartUrl;
                }}
              >
                {ssoBusy ? (
                  <span className="spinner" />
                ) : (
                  <>
                    <GoogleMark />
                    Continue with Google
                  </>
                )}
              </button>
            </>
          )}
          </>
          )}

          <div className={`server-chip ${health}`}>
            <span className="dot" />
            {health === "checking"
              ? "Connecting to StackUp…"
              : health === "ok"
                ? "All systems operational"
                : healthMsg
                  ? `Database unavailable — ${healthMsg}`
                  : "Can't reach the server"}
          </div>
        </div>
      </main>
    </div>
  );
}
