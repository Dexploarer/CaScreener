import type { Spec } from "@json-render/react";

export function toSpec(s: { root: string; elements: Record<string, unknown> }): Spec {
  return s as Spec;
}

export const initialData = { user: { name: "Guest" }, form: {} };

export const validators: Record<string, (v: unknown) => boolean> = {
  required: (v) => v != null && String(v).trim() !== "",
};
