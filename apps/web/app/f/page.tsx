"use client";

/**
 * Module 11 — the PUBLIC form page (`/f?token=…`).
 *
 * Lives outside the (app) group on purpose: no AppShell, no auth guard,
 * no localStorage. Anyone with the link can load the form and submit —
 * every network call goes through the anonymous `publicFormsApi`.
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ApiError, publicFormsApi, type PublicForm } from "@/lib/api";
import { FormRenderer } from "@/components/FormRenderer";
import { Icons, StackMark } from "@/components/icons";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; form: PublicForm }
  | { kind: "closed" }
  | { kind: "offline" };

function PublicFormView() {
  const search = useSearchParams();
  const token = search.get("token") ?? "";
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (!token) {
      setState({ kind: "closed" });
      return;
    }
    let stale = false;
    setState({ kind: "loading" });
    publicFormsApi
      .get(token)
      .then((r) => {
        if (!stale) setState({ kind: "ready", form: r.form });
      })
      .catch((err) => {
        if (stale) return;
        // Network failure gets a retry hint; anything else (404, gone,
        // deactivated, rotated token) reads as "no longer accepting".
        if (err instanceof ApiError && err.status === 0) setState({ kind: "offline" });
        else setState({ kind: "closed" });
      });
    return () => {
      stale = true;
    };
  }, [token]);

  return (
    <div className="pub-wrap">
      <div className="pub-glow pub-glow-a" aria-hidden="true" />
      <div className="pub-glow pub-glow-b" aria-hidden="true" />

      <header className="pub-top">
        <span className="brand">
          <span className="brand-mark">
            <StackMark />
          </span>
          <span className="brand-name">
            Stack<span className="up">Up</span>
          </span>
        </span>
      </header>

      <main className="pub-main">
        {state.kind === "loading" ? (
          <div className="pub-card pub-loading" aria-busy="true">
            <span className="skel" style={{ width: "55%", height: 26 }} />
            <span className="skel" style={{ width: "85%", height: 14 }} />
            <span className="skel" style={{ width: "100%", height: 42 }} />
            <span className="skel" style={{ width: "100%", height: 42 }} />
            <span className="skel" style={{ width: "100%", height: 84 }} />
          </div>
        ) : state.kind === "ready" ? (
          <FormRenderer
            form={state.form}
            onSubmit={(values) => publicFormsApi.submit(token, values).then(() => undefined)}
          />
        ) : state.kind === "offline" ? (
          <div className="pub-card pub-closed" role="alert">
            <span className="pub-closed-ic">{Icons.info}</span>
            <h2>Can't reach the server</h2>
            <p>Check your connection and refresh this page to try again.</p>
          </div>
        ) : (
          <div className="pub-card pub-closed" role="alert">
            <span className="pub-closed-ic">{Icons.ban}</span>
            <h2>This form is no longer accepting responses.</h2>
            <p>
              The link may have expired or the form was closed by its owner. If you
              think this is a mistake, ask whoever shared it for a fresh link.
            </p>
          </div>
        )}
      </main>

      <footer className="pub-footer">
        <span className="pub-powered">
          Powered by{" "}
          <span className="pub-powered-brand">
            <StackMark /> StackUp
          </span>{" "}
          — one app to plan, track, and get work done.
        </span>
      </footer>
    </div>
  );
}

export default function PublicFormPage() {
  return (
    <Suspense
      fallback={
        <div className="pub-wrap">
          <main className="pub-main">
            <div className="pub-card pub-loading" aria-busy="true">
              <span className="skel" style={{ width: "55%", height: 26 }} />
              <span className="skel" style={{ width: "100%", height: 42 }} />
            </div>
          </main>
        </div>
      }
    >
      <PublicFormView />
    </Suspense>
  );
}
