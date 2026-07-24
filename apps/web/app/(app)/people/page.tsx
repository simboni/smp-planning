"use client";

/**
 * People — Members and Teams under one roof.
 *
 * One nav entry, two tabs; both tabs render the full original pages
 * unchanged (invites, role management, team CRUD all intact). The /members
 * and /teams routes still exist for deep links — this is purely a menu
 * consolidation.
 */

import { useState } from "react";
import { Icons } from "@/components/icons";
import MembersPage from "../members/page";
import TeamsPage from "../teams/page";

export default function PeoplePage() {
  const [tab, setTab] = useState<"members" | "teams">("members");

  return (
    <div className="people-wrap">
      <div className="page people-tabs-head">
        <div className="chips" role="tablist" aria-label="People">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "members"}
            className={`chip${tab === "members" ? " active" : ""}`}
            onClick={() => setTab("members")}
          >
            {Icons.members} Members
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "teams"}
            className={`chip${tab === "teams" ? " active" : ""}`}
            onClick={() => setTab("teams")}
          >
            {Icons.team} Teams
          </button>
        </div>
      </div>
      {tab === "members" ? <MembersPage /> : <TeamsPage />}
    </div>
  );
}
