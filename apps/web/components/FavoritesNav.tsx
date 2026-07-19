"use client";

/**
 * Module 14 — the "Favorites" section pinned at the top of the sidebar tree.
 * Lists the user's starred spaces / lists / docs with quick links. Stays
 * subtle: renders nothing until there's at least one favorite.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Icons, type IconKey } from "@/components/icons";
import { useFavorites } from "@/components/FavoritesProvider";
import type { FavoriteType } from "@/lib/api";

const HREF: Record<FavoriteType, string> = {
  space: "/space",
  list: "/list",
  doc: "/doc",
};
const ICON: Record<FavoriteType, IconKey> = {
  space: "spaces",
  list: "list",
  doc: "docs",
};

export function FavoritesNav() {
  const { favorites } = useFavorites();
  const pathname = usePathname();
  const search = useSearchParams();
  if (favorites.length === 0) return null;
  const activeId = search.get("id");

  return (
    <div className="nav-section fav-section">
      <div className="nav-title">{Icons.starFill} Favorites</div>
      <div className="fav-list">
        {favorites.map((f) => {
          const active = pathname === HREF[f.entityType] && activeId === f.entityId;
          return (
            <Link
              key={`${f.entityType}:${f.entityId}`}
              href={`${HREF[f.entityType]}?id=${f.entityId}`}
              className={`navlink fav-link${active ? " active" : ""}`}
              title={f.name}
            >
              {Icons[ICON[f.entityType]]}
              <span className="fav-link-name">{f.name}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
