/**
 * Code export utilities. Uses @json-render/codegen when available,
 * otherwise a minimal implementation for the flat root/elements spec.
 */

export type FlatSpec = {
  root: string;
  elements: Record<
    string,
    { type: string; props: Record<string, unknown>; children: string[] }
  >;
};

export function collectUsedComponents(spec: FlatSpec | null): Set<string> {
  if (!spec?.elements) return new Set();
  const set = new Set<string>();
  for (const el of Object.values(spec.elements)) {
    if (el?.type) set.add(el.type);
  }
  return set;
}

export function serializeProps(props: Record<string, unknown>): string {
  return Object.entries(props)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => {
      if (typeof v === "string") return `${k}="${v.replace(/"/g, '\\"')}"`;
      if (typeof v === "number" || typeof v === "boolean") return `${k}={${v}}`;
      if (typeof v === "object") return `${k}={${JSON.stringify(v)}}`;
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

export function specToReactLikeCode(spec: FlatSpec | null): string {
  if (!spec?.root || !spec.elements) return "// No spec to export";
  const s = spec;

  const components = collectUsedComponents(s);
  const lines: string[] = [
    "// Generated from json-render spec",
    "// Components used: " + [...components].join(", "),
    "",
  ];

  function renderElement(key: string, indent: number): string {
    const el = s.elements[key];
    if (!el) return "";
    const propsStr = serializeProps(el.props);
    const type = el.type;
    const children = (el.children ?? [])
      .map((k) => renderElement(k, indent + 1))
      .filter(Boolean)
      .join("\n");
    const ind = "  ".repeat(indent);
    if (children) {
      return `${ind}<${type} ${propsStr}>\n${children}\n${ind}</${type}>`;
    }
    return `${ind}<${type} ${propsStr} />`;
  }

  lines.push(renderElement(s.root, 0));
  return lines.join("\n");
}
