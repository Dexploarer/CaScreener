"use client";

import React from "react";

type ComponentMap = Map<string, { id: string; component: Record<string, Record<string, unknown>> }>;

function resolveBoundValue(bound: { literalString?: string; path?: string } | undefined, dataModel: Record<string, unknown>): string | undefined {
  if (!bound) return undefined;
  if (bound.literalString != null) return bound.literalString;
  if (bound.path) {
    const parts = bound.path.replace(/^\//, "").split("/");
    let value: unknown = dataModel;
    for (const p of parts) value = (value as Record<string, unknown>)?.[p];
    return value != null ? String(value) : undefined;
  }
  return undefined;
}

const components: Record<
  string,
  (props: Record<string, unknown> & { children?: React.ReactNode; onAction?: (action: unknown) => void }) => React.ReactNode
> = {
  Text: ({ text, usageHint }) => {
    const Tag = (typeof usageHint === "string" && usageHint.startsWith("h")) ? (usageHint as "h1" | "h2" | "h3") : "p";
    return <Tag className="text-zinc-100">{typeof text === "string" ? text : ""}</Tag>;
  },
  Button: ({ children, action, onAction }) => (
    <button
      type="button"
      className="px-4 py-2 bg-emerald-600 text-white rounded-lg"
      onClick={() => onAction?.(action)}
    >
      {children}
    </button>
  ),
  DateTimeInput: ({ label, value, valuePath, onStateChange }) => (
    <label className="block text-sm text-zinc-400">
      {typeof label === "string" ? label : "Date"}
      <input
        type="date"
        value={(value as string) ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (valuePath && typeof onStateChange === "function") onStateChange(valuePath, v);
        }}
        className="ml-2 border border-zinc-600 rounded bg-zinc-900 text-zinc-100 px-2 py-1"
      />
    </label>
  ),
  Column: ({ children }) => <div className="flex flex-col gap-2">{children}</div>,
  Row: ({ children }) => <div className="flex gap-2 flex-wrap">{children}</div>,
};

export function renderA2UI(
  componentMap: ComponentMap,
  dataModel: Record<string, unknown>,
  rootId: string,
  onAction?: (action: unknown) => void,
  onStateChange?: (path: string, value: unknown) => void
): React.ReactNode {
  function render(id: string): React.ReactNode {
    const comp = componentMap.get(id);
    if (!comp) return null;
    const [type, props] = Object.entries(comp.component)[0] ?? [];
    const Component = components[type];
    if (!Component) return <span key={id} className="text-zinc-500">Unknown: {type}</span>;

    const resolved: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(props as Record<string, unknown>)) {
      if (key === "child") {
        resolved.children = render(val as string);
      } else if (key === "children" && val != null && typeof val === "object" && "explicitList" in val) {
        resolved.children = (val as { explicitList: string[] }).explicitList.map(render);
      } else if (val != null && typeof val === "object" && ("literalString" in val || "path" in val)) {
        const bound = val as { literalString?: string; path?: string };
        resolved[key] = resolveBoundValue(bound, dataModel);
        if (bound.path && key === "value") resolved.valuePath = bound.path;
      } else {
        resolved[key] = val;
      }
    }
    return (
      <React.Fragment key={id}>
        {React.createElement(Component as React.ComponentType<Record<string, unknown>>, {
          ...resolved,
          onAction,
          onStateChange,
        })}
      </React.Fragment>
    );
  }
  return render(rootId);
}
