"use client";

import { Suspense } from "react";
import { useHeliusDashboard } from "./use-helius-dashboard";
import { HeliusView } from "./helius-view";

function HeliusContent() {
  const state = useHeliusDashboard();
  return <HeliusView {...state} />;
}

export default function HeliusPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto px-4 py-12">
          <p className="text-zinc-500">Loading…</p>
        </div>
      }
    >
      <HeliusContent />
    </Suspense>
  );
}
