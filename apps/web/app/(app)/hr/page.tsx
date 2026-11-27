"use client";

/**
 * The HR directory now lives in People (Directory tab). This route stays so
 * old links and bookmarks keep working.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HrRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/people?tab=directory");
  }, [router]);
  return null;
}
