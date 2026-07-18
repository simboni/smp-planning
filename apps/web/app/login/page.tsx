"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  API_BASE,
  ApiError,
  authApi,
  clearTokens,
  getIdentityToken,
  setIdentityToken,
  setRefreshToken,
  setUser,
} from "@/lib/api";
import { Icons, StackMark } from "@/components/icons";

type Mode = "login" | "signup";
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

  // Already have an identity? Skip straight to workspace selection.
  useEffect(() => {
    if (getIdentityToken()) router.replace("/select");
  }, [router]);

  // Lightweight backend heartbeat for the status chip.
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/health`)
      .then((r) => r.json().catch(() => ({})))
      .then((b: { status?: string }) => {
        if (alive) setHealth(b.status === "ok" ? "ok" : "down");
      })
      .catch(() => {
        if (alive) setHealth("down");
      });
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      clearTokens();
      const result =
        mode === "signup"
          ? await authApi.signup({
              fullName: fullName.trim(),
              email: email.trim(),
              password,
            })
          : await authApi.login({ email: email.trim(), password });

      setIdentityToken(result.identityToken);
      setRefreshToken(result.refreshToken);
      setUser(result.user);
      // Whether they have workspaces or not, /select handles both (list or
      // "create your first workspace").
      router.replace("/select");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again.",
      );
      setBusy(false);
    }
  };

  const switchMode = (m: Mode): void => {
    setMode(m);
    setError("");
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
                  aria-label={showPw ? "Hide password" : "Show password"}
                  onClick={() => setShowPw((v) => !v)}
                >
                  {showPw ? "🙈" : "👁"}
                </button>
              </div>
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

          <div className={`server-chip ${health}`}>
            <span className="dot" />
            {health === "checking"
              ? "Connecting to StackUp…"
              : health === "ok"
                ? "All systems operational"
                : "Can't reach the server"}
          </div>
        </div>
      </main>
    </div>
  );
}
