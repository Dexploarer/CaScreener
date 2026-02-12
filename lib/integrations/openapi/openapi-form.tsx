"use client";

import React, { useState } from "react";
import type { OperationSpec } from "./openapi-to-spec";

export function OpenAPIForm({
  spec,
  onSubmit,
}: {
  spec: OperationSpec;
  onSubmit: (data: Record<string, unknown>) => void | Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);

  const formEl = spec.elements[spec.root];
  if (!formEl || formEl.type !== "Form") return null;

  const childIds = formEl.children ?? [];

  const handleChange = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(values);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-6 space-y-4"
    >
      <h2 className="text-xl font-bold text-zinc-100">{spec.title}</h2>
      {spec.description && (
        <p className="text-zinc-400 text-sm">{spec.description}</p>
      )}
      <div className="space-y-4">
        {childIds.map((id) => {
          const el = spec.elements[id];
          if (!el) return null;
          const { type, props } = el;
          const name = props.name as string;
          const value = values[name];
          const setValue = (v: unknown) => handleChange(name, v);

          if (type === "StringField") {
            return (
              <label key={id} className="block text-sm text-zinc-400">
                {props.label as string}
                <input
                  type={(props.format as string) === "email" ? "email" : "text"}
                  value={(value as string) ?? ""}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={props.placeholder as string}
                  className="mt-1 w-full border border-zinc-600 rounded-lg bg-zinc-900 px-3 py-2 text-zinc-100"
                />
              </label>
            );
          }
          if (type === "NumberField") {
            return (
              <label key={id} className="block text-sm text-zinc-400">
                {props.label as string}
                <input
                  type="number"
                  value={(value as number) ?? ""}
                  onChange={(e) => setValue(e.target.value ? Number(e.target.value) : undefined)}
                  min={props.minimum as number}
                  max={props.maximum as number}
                  className="mt-1 w-full border border-zinc-600 rounded-lg bg-zinc-900 px-3 py-2 text-zinc-100"
                />
              </label>
            );
          }
          if (type === "BooleanField") {
            return (
              <label key={id} className="flex items-center gap-2 text-sm text-zinc-400">
                <input
                  type="checkbox"
                  checked={(value as boolean) ?? false}
                  onChange={(e) => setValue(e.target.checked)}
                  className="rounded border-zinc-600"
                />
                {props.label as string}
              </label>
            );
          }
          if (type === "EnumField") {
            const options = (props.options as Array<{ value: string; label?: string }>) ?? [];
            return (
              <label key={id} className="block text-sm text-zinc-400">
                {props.label as string}
                <select
                  value={(value as string) ?? ""}
                  onChange={(e) => setValue(e.target.value)}
                  className="mt-1 w-full border border-zinc-600 rounded-lg bg-zinc-900 px-3 py-2 text-zinc-100"
                >
                  <option value="">Select...</option>
                  {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label ?? opt.value}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          return null;
        })}
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="px-4 py-2 bg-emerald-600 text-white rounded-lg disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit"}
      </button>
    </form>
  );
}
