"use client";

import { useState, useMemo } from "react";
import { renderA2UI } from "@/lib/integrations/a2ui/renderer";

const SAMPLE_MESSAGE = {
  surfaceUpdate: {
    surfaceId: "main",
    components: [
      {
        id: "root",
        component: {
          Column: {
            children: { explicitList: ["header", "date-picker", "submit-btn"] },
          },
        },
      },
      {
        id: "header",
        component: {
          Text: {
            text: { literalString: "Book Your Table" },
            usageHint: "h1",
          },
        },
      },
      {
        id: "date-picker",
        component: {
          DateTimeInput: {
            label: { literalString: "Select Date" },
            value: { path: "/reservation/date" },
            enableDate: true,
          },
        },
      },
      {
        id: "submit-btn",
        component: {
          Button: {
            child: "submit-text",
            action: { name: "confirm_booking" },
          },
        },
      },
      {
        id: "submit-text",
        component: {
          Text: {
            text: { literalString: "Confirm Reservation" },
          },
        },
      },
    ],
  },
  beginRendering: { root: "root" },
};

function buildMap(
  comps: Array<{ id: string; component: Record<string, unknown> }>
): Map<string, { id: string; component: Record<string, Record<string, unknown>> }> {
  const map = new Map();
  for (const c of comps) {
    map.set(c.id, { id: c.id, component: c.component as Record<string, Record<string, unknown>> });
  }
  return map;
}

export default function A2UIPage() {
  const [dataModel, setDataModel] = useState<Record<string, unknown>>({
    reservation: { date: "" },
  });

  const { surfaceUpdate, beginRendering } = SAMPLE_MESSAGE;
  const componentMap = useMemo(
    () => (surfaceUpdate ? buildMap(surfaceUpdate.components) : new Map()),
    [surfaceUpdate]
  );
  const rootId = beginRendering?.root ?? "header";

  const handleAction = (action: unknown) => {
    console.log("A2UI action:", action);
  };

  const handleStateChange = (path: string, value: unknown) => {
    const parts = path.replace(/^\//, "").split("/").filter(Boolean);
    if (parts.length === 0) return;
    setDataModel((prev) => {
      const setNested = (obj: Record<string, unknown>, idx: number): Record<string, unknown> => {
        const key = parts[idx];
        if (idx === parts.length - 1) return { ...obj, [key]: value };
        const child = (obj[key] ?? {}) as Record<string, unknown>;
        return { ...obj, [key]: setNested(child, idx + 1) };
      };
      return setNested({ ...prev }, 0) as Record<string, unknown>;
    });
  };

  const ui =
    rootId && componentMap.size > 0
      ? renderA2UI(componentMap, dataModel, rootId, handleAction, handleStateChange)
      : null;

  return (
    <main className="container mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold text-zinc-100 mb-2">A2UI Integration</h1>
      <p className="text-zinc-400 mb-6">
        Google&apos;s Agent-to-User Interaction protocol: flat component list with ID references.
      </p>
      <div className="max-w-md rounded-xl border border-zinc-700 bg-zinc-900/30 p-6 space-y-4">
        {ui}
      </div>
      <p className="mt-4 text-zinc-500 text-sm">
        Data binding: <code className="bg-zinc-800 px-1 rounded">/reservation/date</code> is bound to the date input.
      </p>
    </main>
  );
}
