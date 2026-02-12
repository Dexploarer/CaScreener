'use client';

import { Suspense } from "react";
import { PredictionsView } from "./predictions-view";
import { usePredictions } from "./use-predictions";

function PredictionsContent() {
  const state = usePredictions();
  return <PredictionsView {...state} />;
}

export default function PredictionsPage() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-12 text-zinc-500">Loading prediction markets…</div>}>
      <PredictionsContent />
    </Suspense>
  );
}


