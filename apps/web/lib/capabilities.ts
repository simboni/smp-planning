"use client";

import { useEffect, useState } from "react";
import { getWorkspace, governanceApi, type Capability } from "@/lib/api";

/**
 * The caller's own role capabilities (Settings → Roles), fetched once per
 * workspace and shared. The server enforces every one of them; this only
 * hides actions the role can't take. `null` while loading — callers treat
 * that as "allowed" so nothing flickers away for owners/admins.
 */
type Caps = Record<Capability, boolean>;
let cache: { ws: string; caps: Promise<Caps> } | null = null;

export function loadCapabilities(): Promise<Caps> | null {
  const ws = getWorkspace();
  if (!ws) return null;
  if (!cache || cache.ws !== ws.id) {
    const caps = governanceApi.me().then((r) => r.capabilities);
    caps.catch(() => { if (cache?.caps === caps) cache = null; });
    cache = { ws: ws.id, caps };
  }
  return cache.caps;
}

export function useCapabilities(): Caps | null {
  const [caps, setCaps] = useState<Caps | null>(null);
  useEffect(() => {
    let live = true;
    loadCapabilities()?.then((c) => { if (live) setCaps(c); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return caps;
}

/** True unless the capability is known to be off. */
export function allowed(caps: Caps | null, cap: Capability): boolean {
  return caps === null || caps[cap] !== false;
}
