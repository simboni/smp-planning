"use client";

/**
 * Module 14 — a subtle ⭐ toggle for space / list / doc page headers. Reads &
 * writes the shared FavoritesProvider so the sidebar Favorites section stays
 * in sync. Renders as a plain icon button; filled + gold when starred.
 */

import { Icons } from "@/components/icons";
import { useFavorites } from "@/components/FavoritesProvider";
import type { FavoriteType } from "@/lib/api";

export function FavoriteStar({
  type,
  id,
  name,
  className = "",
}: {
  type: FavoriteType;
  id: string;
  name: string;
  className?: string;
}) {
  const { isFavorite, toggle } = useFavorites();
  const on = isFavorite(type, id);
  return (
    <button
      type="button"
      className={`fav-star${on ? " on" : ""} ${className}`.trim()}
      aria-pressed={on}
      title={on ? "Remove from favorites" : "Add to favorites"}
      aria-label={on ? "Remove from favorites" : "Add to favorites"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(type, id, name);
      }}
    >
      {on ? Icons.starFill : Icons.star}
    </button>
  );
}
