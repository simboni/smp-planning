"use client";

/**
 * Shared hierarchy store. Fetches the Spaces → Folders → Lists tree once and
 * exposes it to the sidebar tree and the space/list pages so navigation and
 * content stay in sync. Any mutation (create/rename/reorder/…) calls `reload`
 * to refetch the source of truth; callers may also `setTree` for optimistic
 * updates.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { hierarchyApi, type HierarchyTree, type SpaceTree } from "@/lib/api";

interface HierarchyContextValue {
  tree: SpaceTree[];
  loading: boolean;
  error: string;
  /** Refetch the whole tree from the API. */
  reload: () => Promise<void>;
  /** Optimistically replace the tree (mutators use this before reload). */
  setTree: (updater: (prev: SpaceTree[]) => SpaceTree[]) => void;
}

const HierarchyContext = createContext<HierarchyContextValue | null>(null);

export function HierarchyProvider({ children }: { children: React.ReactNode }) {
  const [tree, setTreeState] = useState<SpaceTree[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadedOnce = useRef(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const data: HierarchyTree = await hierarchyApi.getTree();
      setTreeState(data.spaces ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your spaces.");
    } finally {
      setLoading(false);
      loadedOnce.current = true;
    }
  }, []);

  const setTree = useCallback(
    (updater: (prev: SpaceTree[]) => SpaceTree[]) => {
      setTreeState((prev) => updater(prev));
    },
    [],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <HierarchyContext.Provider
      value={{ tree, loading, error, reload, setTree }}
    >
      {children}
    </HierarchyContext.Provider>
  );
}

export function useHierarchy(): HierarchyContextValue {
  const ctx = useContext(HierarchyContext);
  if (!ctx) {
    throw new Error("useHierarchy must be used within a HierarchyProvider");
  }
  return ctx;
}
