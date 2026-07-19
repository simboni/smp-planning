"use client";

/**
 * Module 10 — Sprint report (/sprint?id=<sprintId>). Header with the
 * sprint's dates and points, the burndown line chart (shared SVG comp
 * with the dashboard card), velocity bars across the space's sprints,
 * and a jump to the sprint's list (a sprint IS a list).
 */

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ApiError, sprintsApi, type SprintReport } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { Icons } from "@/components/icons";
import { Bars, ChartEmpty, ChartLegend, LineChart } from "@/components/charts";
import { formatDateRange, formatPercent, sprintPhase } from "@/lib/format";

function PhaseBadge({ report }: { report: SprintReport }) {
  if (report.sprint.archived) {
    return <span className="badge badge-soon">{Icons.archive} Archived</span>;
  }
  const phase = sprintPhase(report.sprint.startDate, report.sprint.endDate);
  if (phase === "active") return <span className="badge spr-badge-active">Active</span>;
  if (phase === "upcoming") return <span className="badge spr-badge-upcoming">Upcoming</span>;
  return <span className="badge spr-badge-past">Past</span>;
}

function SprintView() {
  const search = useSearchParams();
  const id = search.get("id");

  const [report, setReport] = useState<SprintReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = (): void => {
    if (!id) return;
    sprintsApi
      .report(id)
      .then((r) => {
        setReport(r);
        setError("");
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load this sprint."),
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useRealtime((e) => {
    if (e.type === "task.changed") load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!id) {
    return (
      <div className="page">
        <div className="empty-state">
          <span className="empty-ic">{Icons.gantt}</span>
          <h3>No sprint selected</h3>
          <p>Open a sprint report from its space page.</p>
          <Link href="/everything" className="btn btn-soft">Browse spaces</Link>
        </div>
      </div>
    );
  }

  if (loading && !report) {
    return (
      <div className="page">
        <span className="skel" style={{ width: 260, height: 32, marginBottom: 18 }} />
        <span className="skel" style={{ width: "100%", height: 260, borderRadius: 14 }} />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="page">
        <div className="form-error">{error || "Sprint not found."}</div>
        <Link href="/everything" className="btn btn-soft">Back to Everything</Link>
      </div>
    );
  }

  const total = Number(report.totalPoints) || 0;
  const completed = Number(report.completedPoints) || 0;
  const remaining = Math.max(total - completed, 0);
  const pct = total > 0 ? completed / total : 0;
  const burndownDays = report.burndown?.days ?? [];
  const velocity = report.velocity ?? [];

  return (
    <div className="page">
      <div className="spr-report-head">
        <div className="spr-report-title">
          <h1>{report.sprint.name}</h1>
          <PhaseBadge report={report} />
        </div>
        <div className="spr-report-meta">
          <span className="spr-date-chip">
            {Icons.calendar}
            {formatDateRange(report.sprint.startDate, report.sprint.endDate)}
          </span>
          <Link href={`/list?id=${report.sprint.listId}`} className="btn btn-soft btn-sm">
            {Icons.list} Open sprint list
          </Link>
        </div>
      </div>

      {/* stat tiles */}
      <div className="spr-stats">
        <div className="spr-stat">
          <span className="spr-stat-val">{total}</span>
          <span className="spr-stat-label">Total points</span>
        </div>
        <div className="spr-stat">
          <span className="spr-stat-val ok">{completed}</span>
          <span className="spr-stat-label">Completed</span>
        </div>
        <div className="spr-stat">
          <span className="spr-stat-val">{remaining}</span>
          <span className="spr-stat-label">Remaining</span>
        </div>
        <div className="spr-stat">
          <span className="spr-stat-val brand">{formatPercent(pct)}</span>
          <span className="spr-stat-label">Done</span>
        </div>
      </div>

      <section className="card spr-chart-card">
        <div className="spr-chart-head">
          <h3>Burndown</h3>
          <ChartLegend
            items={[
              { label: "Remaining", color: "var(--brand)" },
              { label: "Ideal", color: "var(--muted)", dashed: true },
            ]}
          />
        </div>
        {burndownDays.length === 0 ? (
          <ChartEmpty>No burndown data yet — add points to the sprint's tasks.</ChartEmpty>
        ) : (
          <LineChart days={burndownDays} totalPoints={total} height={240} />
        )}
      </section>

      <section className="card spr-chart-card">
        <div className="spr-chart-head">
          <h3>Velocity</h3>
          <span className="muted spr-chart-sub">Completed points per sprint</span>
        </div>
        {velocity.length === 0 ? (
          <ChartEmpty>No finished sprints to compare yet.</ChartEmpty>
        ) : (
          <Bars
            points={velocity.map((v) => ({
              label: v.name,
              value: Number(v.completedPoints) || 0,
              hint: `${v.name} — ${Number(v.completedPoints) || 0} pts completed`,
              highlight: v.sprintId === report.sprint.id,
            }))}
            formatValue={(v) => `${v}`}
            height={180}
          />
        )}
      </section>
    </div>
  );
}

export default function SprintPage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <span className="skel" style={{ width: 260, height: 32 }} />
        </div>
      }
    >
      <SprintView />
    </Suspense>
  );
}
