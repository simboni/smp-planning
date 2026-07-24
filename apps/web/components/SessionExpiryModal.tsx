"use client";

/**
 * "Still working?" — shown when a session times out instead of hard-bouncing
 * the user to login. "Still working" renews the session in place (via the
 * long-lived refresh token) and the original request is retried, so the user
 * stays exactly where they were. "Log out" ends the session. If renewal fails
 * (the refresh token itself expired), the app falls back to the login screen.
 */

import { useState } from "react";
import { renewSession } from "@/lib/api";
import { Icons } from "@/components/icons";

export function SessionExpiryModal({
  resolve,
}: {
  resolve: (renewed: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);

  const keepWorking = async () => {
    setBusy(true);
    const ok = await renewSession();
    // true → continue on the same page; false → api() falls back to login.
    resolve(ok);
  };

  return (
    <div className="sx-scrim">
      <div className="sx" role="dialog" aria-modal="true" aria-labelledby="sx-title">
        <span className="sx-ic">{Icons.clock}</span>
        <h2 id="sx-title" className="sx-title">
          Still working?
        </h2>
        <p className="sx-body">
          Your session timed out for security. Pick up right where you left off,
          or log out.
        </p>
        <div className="sx-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => resolve(false)}
            disabled={busy}
          >
            Log out
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={keepWorking}
            disabled={busy}
            autoFocus
          >
            {busy ? (
              <>
                <span className="aib-spin" aria-hidden="true" /> Resuming…
              </>
            ) : (
              "Still working"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
