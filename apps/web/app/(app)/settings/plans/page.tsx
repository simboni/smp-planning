"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getWorkspace,
  plansApi,
  workspacesApi,
  type PlanDef,
  type PlanId,
  type WorkspaceRole,
} from "@/lib/api";
import { Icons } from "@/components/icons";

function formatBytes(n: number): string {
  const GB = 1024 * 1024 * 1024;
  if (n >= GB) return `${Math.round(n / GB)} GB`;
  return `${Math.round(n / (1024 * 1024))} MB`;
}

function price(p: PlanDef): string {
  if (p.pricePerMemberMonth === null) return "Contact us";
  if (p.pricePerMemberMonth === 0) return "Free";
  return `$${p.pricePerMemberMonth}`;
}

export default function PlansPage() {
  const [plans, setPlans] = useState<PlanDef[] | null>(null);
  const [current, setCurrent] = useState<PlanId | null>(null);
  const [role, setRole] = useState<WorkspaceRole | null>(getWorkspace()?.role ?? null);
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState("");

  const load = () =>
    plansApi
      .list()
      .then((r) => {
        setPlans(r.plans);
        setCurrent(r.current);
      })
      .catch(() => setPlans([]));

  useEffect(() => {
    load();
    workspacesApi
      .current()
      .then((r) => setRole(r.role))
      .catch(() => undefined);
  }, []);

  const isOwner = role === "owner";

  const choose = async (id: PlanId) => {
    setBusy(id);
    setError("");
    try {
      await plansApi.select(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not switch plans.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <Link href="/settings" className="back-link">
        {Icons.chevronRight}
        <span>Settings</span>
      </Link>
      <div className="page-head">
        <h1>Plans &amp; billing</h1>
        <p className="sub">
          Pick the plan that fits your team. Upgrades apply instantly
          {isOwner ? "" : " — only the workspace owner can change the plan"}.
        </p>
      </div>

      {error && <div className="form-error">{error}</div>}

      {plans === null ? (
        <div className="skel" style={{ height: 220 }} />
      ) : (
        <div className="plan-grid">
          {plans.map((p) => {
            const active = p.id === current;
            const popular = p.id === "business";
            return (
              <div className={`plan-card${active ? " active" : ""}${popular ? " popular" : ""}`} key={p.id}>
                {popular && <span className="plan-flag">Most popular</span>}
                <div className="plan-name">{p.name}</div>
                <div className="plan-price">
                  {price(p)}
                  {p.pricePerMemberMonth ? (
                    <span className="plan-per">/ member / month</span>
                  ) : null}
                </div>
                <div className="plan-tagline">{p.tagline}</div>
                <ul className="plan-points">
                  {p.highlights.map((h) => (
                    <li key={h}>
                      <span className="plan-check">{Icons.check}</span>
                      {h}
                    </li>
                  ))}
                </ul>
                <div className="plan-meta">
                  {formatBytes(p.storageBytes)} storage ·{" "}
                  {p.automationsPerMonth.toLocaleString()} automations/mo
                </div>
                {active ? (
                  <span className="btn btn-soft btn-block plan-current">Current plan</span>
                ) : (
                  <button
                    className={`btn ${popular ? "btn-primary" : "btn-soft"} btn-block`}
                    disabled={!isOwner || busy !== null}
                    onClick={() => choose(p.id)}
                    title={isOwner ? undefined : "Only the workspace owner can change the plan"}
                  >
                    {busy === p.id ? (
                      <span className="spinner" />
                    ) : p.pricePerMemberMonth === null ? (
                      "Choose Enterprise"
                    ) : (
                      `Switch to ${p.name}`
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="notice" style={{ marginTop: 20 }}>
        {Icons.info}
        Payments aren&apos;t wired up yet — the owner can switch plans freely.
        Card billing plugs into this page when you&apos;re ready to charge.
      </div>
    </div>
  );
}
