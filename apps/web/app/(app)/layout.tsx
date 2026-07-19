"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAccessToken } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { HierarchyProvider } from "@/components/HierarchyProvider";
import { FavoritesProvider } from "@/components/FavoritesProvider";
import { StackMark } from "@/components/icons";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [router]);

  // Avoid flashing the shell before the auth check resolves.
  if (!ready) {
    return (
      <div className="splash">
        <span className="brand-mark lg">
          <StackMark />
        </span>
      </div>
    );
  }

  return (
    <HierarchyProvider>
      <FavoritesProvider>
        <AppShell>{children}</AppShell>
      </FavoritesProvider>
    </HierarchyProvider>
  );
}
