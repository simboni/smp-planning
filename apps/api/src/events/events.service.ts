import { Injectable } from "@nestjs/common";

/** A tiny realtime event: clients treat payloads as hints and refetch. */
export interface RealtimeEvent {
  type: string;
  payload: Record<string, unknown>;
}

type Listener = (event: RealtimeEvent) => void;

/**
 * In-process pub/sub bus keyed by workspace, powering the SSE stream
 * (events.controller.ts). Services publish tiny change hints
 * (`task.changed`, `comment.changed`, `notification.new`, `presence`) after
 * their mutations; every SSE connection for that workspace gets each event.
 *
 * Presence is a per-workspace refcount of open SSE connections per user (a
 * user with two tabs counts once in online() but only disappears when both
 * close). Single-process by design — matches the single-pool DbService.
 */
@Injectable()
export class EventsService {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly presence = new Map<string, Map<string, number>>();

  publish(workspaceId: string, event: RealtimeEvent): void {
    const subs = this.listeners.get(workspaceId);
    if (!subs) return;
    for (const fn of subs) {
      try {
        fn(event);
      } catch {
        // One broken sink never blocks the rest.
      }
    }
  }

  /** Register a listener for a workspace; returns its unsubscribe fn. */
  subscribe(workspaceId: string, fn: Listener): () => void {
    let subs = this.listeners.get(workspaceId);
    if (!subs) {
      subs = new Set();
      this.listeners.set(workspaceId, subs);
    }
    subs.add(fn);
    return () => {
      subs.delete(fn);
      if (subs.size === 0) this.listeners.delete(workspaceId);
    };
  }

  /** Count a user's SSE connection into the workspace's presence. */
  connect(workspaceId: string, userId: string): void {
    let users = this.presence.get(workspaceId);
    if (!users) {
      users = new Map();
      this.presence.set(workspaceId, users);
    }
    users.set(userId, (users.get(userId) ?? 0) + 1);
  }

  /** Drop one SSE connection; the user goes offline at refcount zero. */
  disconnect(workspaceId: string, userId: string): void {
    const users = this.presence.get(workspaceId);
    if (!users) return;
    const n = (users.get(userId) ?? 0) - 1;
    if (n > 0) users.set(userId, n);
    else users.delete(userId);
    if (users.size === 0) this.presence.delete(workspaceId);
  }

  /** User ids with at least one open connection in the workspace. */
  online(workspaceId: string): string[] {
    return [...(this.presence.get(workspaceId)?.keys() ?? [])];
  }

  /** Convenience: publish the current presence snapshot for a workspace. */
  publishPresence(workspaceId: string): void {
    this.publish(workspaceId, {
      type: "presence",
      payload: { online: this.online(workspaceId) },
    });
  }
}
