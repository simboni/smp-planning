"use client";

/**
 * Module 13 — Task Email.
 *
 * A per-task email log with a compose form, mounted in the Task panel just
 * below Attachments. Outbound messages are sent through the workspace's
 * configured mail adapter; inbound replies (when threading is wired) show up
 * in the same log. Read-only when `canEdit` is false.
 */

import { useEffect, useRef, useState } from "react";
import { ApiError, emailApi, type TaskEmailRecord } from "@/lib/api";
import { Icons } from "@/components/icons";
import { formatDateTime } from "@/lib/format";

export function TaskEmail({ taskId, canEdit }: { taskId: string; canEdit: boolean }) {
  const [emails, setEmails] = useState<TaskEmailRecord[] | null>(null);
  const [error, setError] = useState("");
  const [composing, setComposing] = useState(false);
  const [sending, setSending] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = (msg: string): void => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  };

  const load = async (): Promise<void> => {
    try {
      const r = await emailApi.list(taskId);
      setEmails(r.emails);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load emails.");
    }
  };

  useEffect(() => {
    setEmails(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const resetForm = (): void => {
    setTo("");
    setSubject("");
    setBody("");
    setComposing(false);
  };

  const canSend = to.trim() !== "" && subject.trim() !== "" && body.trim() !== "";

  const send = async (): Promise<void> => {
    if (!canSend || sending) return;
    setSending(true);
    setError("");
    try {
      await emailApi.send(taskId, {
        to: to.trim(),
        subject: subject.trim(),
        body: body.trim(),
      });
      resetForm();
      flash("Email sent");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send email.");
    } finally {
      setSending(false);
    }
  };

  const count = emails?.length ?? 0;

  return (
    <section className="tp-section">
      <div className="tp-section-head">
        <h3 className="tp-section-title">
          {Icons.mail} Email
          {count > 0 && <span className="tp-count-badge">{count}</span>}
        </h3>
        {canEdit && !composing && (
          <button
            type="button"
            className="btn btn-soft btn-sm"
            onClick={() => setComposing(true)}
          >
            {Icons.plus} Compose
          </button>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {canEdit && composing && (
        <div className="email-compose">
          <input
            className="email-field"
            type="email"
            placeholder="To (email address)"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <input
            className="email-field"
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <textarea
            className="email-field email-textarea"
            placeholder="Write your message…"
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="email-compose-foot">
            <span className="email-adapter-note">
              Sends via your workspace&apos;s configured mail adapter.
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={resetForm}
              disabled={sending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void send()}
              disabled={!canSend || sending}
            >
              {sending ? (
                <>
                  <span className="spinner" style={{ width: 14, height: 14 }} /> Sending…
                </>
              ) : (
                <>
                  {Icons.send} Send
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {emails === null ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="skel" style={{ height: 52 }} />
          <span className="skel" style={{ height: 52 }} />
        </div>
      ) : emails.length === 0 ? (
        <div className="tp-empty tp-empty-pad">No emails yet.</div>
      ) : (
        <ul className="email-log">
          {emails.map((em) => (
            <li key={em.id} className={`email-row email-${em.direction}`}>
              <div className="email-row-head">
                <span
                  className={`email-dir email-dir-${em.direction}`}
                  title={em.direction === "outbound" ? "Sent" : "Received"}
                >
                  {em.direction === "outbound" ? Icons.send : Icons.arrowDown}
                  {em.direction === "outbound" ? "Sent" : "Received"}
                </span>
                <span className="email-subject" title={em.subject}>
                  {em.subject}
                </span>
                <span style={{ flex: 1 }} />
                <span className="email-time">{formatDateTime(em.createdAt)}</span>
              </div>
              <div className="email-addrs">
                <span className="email-addr-label">From</span> {em.fromAddr}
                <span className="email-addr-sep">·</span>
                <span className="email-addr-label">To</span> {em.toAddr}
              </div>
              <div className="email-body">{em.body}</div>
            </li>
          ))}
        </ul>
      )}

      {toast && <div className="toast">{toast}</div>}
    </section>
  );
}
