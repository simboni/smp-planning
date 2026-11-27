"use client";

/**
 * People — one directory for everyone in the workspace (audit: HR and People
 * used to be two near-identical pages).
 *
 *   Directory — designations and departments, searchable (was HR)
 *   Members   — invites, roles and access
 *   Teams     — team CRUD
 *
 * The tab lives in the URL (?tab=directory|members|teams) so links land on
 * the right one; /hr, /members and /teams still work for old links.
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Icons } from "@/components/icons";
import { PeopleDirectory } from "@/components/people/PeopleDirectory";
import MembersPage from "../members/page";
import TeamsPage from "../teams/page";

type Tab = "directory" | "members" | "teams";
const TABS: { key: Tab; label: string; icon: keyof typeof Icons }[] = [
  { key: "directory", label: "Directory", icon: "org" },
  { key: "members", label: "Members", icon: "members" },
  { key: "teams", label: "Teams", icon: "team" },
];

export default function PeoplePage() {
  return (
    <Suspense fallback={null}>
      <People />
    </Suspense>
  );
}

function People() {
  const search = useSearchParams();
  const [tab, setTab] = useState<Tab>("directory");

  // Follow ?tab= — also when it changes while you're already here (e.g. the
  // top-bar Invite button opens the Members tab).
  const fromUrl = search.get("tab");
  useEffect(() => {
    if (fromUrl === "directory" || fromUrl === "members" || fromUrl === "teams") setTab(fromUrl);
  }, [fromUrl]);

  const choose = (t: Tab): void => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url.toString());
  };

  return (
    <div className="people-wrap">
      <div className="page people-tabs-head">
        <div className="page-head">
          <h1>People</h1>
        </div>
        <div className="chips" role="tablist" aria-label="People">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`chip${tab === t.key ? " active" : ""}`}
              onClick={() => choose(t.key)}
            >
              {Icons[t.icon]} {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="people-embed">
        {tab === "directory" ? <PeopleDirectory /> : tab === "members" ? <MembersPage /> : <TeamsPage />}
      </div>
    </div>
  );
}
