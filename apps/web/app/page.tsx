"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getAccessToken, getIdentityToken } from "@/lib/api";
import { StackMark } from "@/components/icons";

export default function IndexPage() {
  const router = useRouter();

  useEffect(() => {
    if (getAccessToken()) router.replace("/dashboard");
    else if (getIdentityToken()) router.replace("/select");
    else router.replace("/login");
  }, [router]);

  return (
    <div className="splash">
      <span className="brand-mark lg">
        <StackMark />
      </span>
      <span className="brand-name" style={{ fontWeight: 800, fontSize: "1.3rem" }}>
        Stack<span className="up">Up</span>
      </span>
    </div>
  );
}
