"use client";

import { useEffect } from "react";

/**
 * Registers the StackUp service worker (M15) once on the client, enabling the
 * offline shell and install-to-home-screen. No-ops during SSR/static export
 * and where service workers are unsupported.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const register = () =>
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);
  return null;
}
