"use client";

/**
 * Module 14 — Favorites store. Fetches the user's starred entities once and
 * shares them with the sidebar "Favorites" section and every ⭐ toggle on the
 * space/list/doc headers, so a star flips in both places at once. Mutations
 * are optimistic with a refetch to reconcile.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { favoritesApi, type Favorite, type FavoriteType } from "@/lib/api";

interface FavoritesContextValue {
  favorites: Favorite[];
  loading: boolean;
  isFavorite: (type: FavoriteType, id: string) => boolean;
  /** Star or unstar; `name` seeds the optimistic row when adding. */
  toggle: (type: FavoriteType, id: string, name: string) => void;
  reload: () => Promise<void>;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const r = await favoritesApi.list();
      setFavorites(r.favorites ?? []);
    } catch {
      /* keep whatever we had */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const isFavorite = useCallback(
    (type: FavoriteType, id: string): boolean =>
      favorites.some((f) => f.entityType === type && f.entityId === id),
    [favorites],
  );

  const toggle = useCallback(
    (type: FavoriteType, id: string, name: string): void => {
      const on = favorites.some((f) => f.entityType === type && f.entityId === id);
      if (on) {
        setFavorites((prev) =>
          prev.filter((f) => !(f.entityType === type && f.entityId === id)),
        );
        favoritesApi.remove(type, id).catch(() => void reload());
      } else {
        setFavorites((prev) => [...prev, { entityType: type, entityId: id, name }]);
        favoritesApi.add(type, id).catch(() => void reload());
      }
    },
    [favorites, reload],
  );

  return (
    <FavoritesContext.Provider value={{ favorites, loading, isFavorite, toggle, reload }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error("useFavorites must be used within a FavoritesProvider");
  return ctx;
}
