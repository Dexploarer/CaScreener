const encoder = new TextEncoder();

export const SPEC_STREAM_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};

const DEFAULT_FALLBACK_SPEC = [
  '{"op":"add","path":"/root","value":"fallback-card"}',
  '{"op":"add","path":"/elements/fallback-card","value":{"type":"Card","props":{"title":"Structured UI Fallback","description":"Recovered from unstructured model output"},"children":["fallback-text"]}}',
  '{"op":"add","path":"/elements/fallback-text","value":{"type":"Text","props":{"content":"The model response was not valid SpecStream JSONL. Re-run this prompt to regenerate a richer dashboard."},"children":[]}}',
].join("\n");

function esc(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "")
    .replace(/\t/g, " ");
}

export function buildStatusSpec(
  title: string,
  description: string,
  note = "Try again in a moment."
): string {
  return [
    '{"op":"add","path":"/root","value":"status-card"}',
    `{"op":"add","path":"/elements/status-card","value":{"type":"Card","props":{"title":"${esc(title)}","description":"${esc(description)}"},"children":["status-note"]}}`,
    `{"op":"add","path":"/elements/status-note","value":{"type":"Text","props":{"content":"${esc(note)}"},"children":[]}}`,
  ].join("\n");
}

export function streamSpec(
  spec: string,
  options?: {
    status?: number;
    headers?: HeadersInit;
    lineDelayMs?: number;
  }
): Response {
  const status = options?.status ?? 200;
  const lineDelayMs = options?.lineDelayMs ?? 20;
  const headers = options?.headers ?? {};
  const lines = spec.split("\n").filter(Boolean);
  const stream = new ReadableStream({
    async start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + "\n"));
        if (lineDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, lineDelayMs));
        }
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: {
      ...SPEC_STREAM_HEADERS,
      ...headers,
    },
  });
}

function extractJsonObjectsFromText(input: string): {
  objects: string[];
  rest: string;
} {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (start === -1) {
      if (ch === "{") {
        start = i;
        depth = 1;
        inString = false;
        escape = false;
      }
      continue;
    }

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        objects.push(input.slice(start, i + 1));
        start = -1;
      }
      continue;
    }
  }

  return {
    objects,
    rest: start >= 0 ? input.slice(start) : "",
  };
}

export function createSpecJsonlFilterStream(options?: {
  fallbackSpec?: string;
  enforceRootElementMapping?: boolean;
}): TransformStream<Uint8Array, Uint8Array> {
  const fallbackSpec = options?.fallbackSpec ?? DEFAULT_FALLBACK_SPEC;
  const enforceRootElementMapping = options?.enforceRootElementMapping ?? true;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let emittedPatchCount = 0;
  let rootKey: string | null = null;
  let firstElementKey: string | null = null;
  let rootResolved = false;
  let rootRepaired = false;
  const elementKeys = new Set<string>();

  const maybeRepairRoot = (
    controller: TransformStreamDefaultController<Uint8Array>,
    force = false
  ) => {
    if (!enforceRootElementMapping) return;
    if (rootRepaired || !rootKey || !firstElementKey) return;
    if (elementKeys.has(rootKey)) {
      rootResolved = true;
      return;
    }

    const normalized = rootKey.trim().toLowerCase();
    const looksPlaceholder =
      normalized === "root" ||
      normalized === "rootkey" ||
      normalized.startsWith("root-") ||
      normalized.includes("dashboard") ||
      normalized.includes("overview");

    if (!force && !looksPlaceholder) return;

    const repairPatch = JSON.stringify({
      op: "replace",
      path: "/root",
      value: firstElementKey,
    });
    emittedPatchCount += 1;
    controller.enqueue(encoder.encode(repairPatch + "\n"));
    rootKey = firstElementKey;
    rootResolved = true;
    rootRepaired = true;
  };

  const processText = (
    text: string,
    controller: TransformStreamDefaultController<Uint8Array>
  ) => {
    if (!text) return;
    buffer += text;
    const { objects, rest } = extractJsonObjectsFromText(buffer);
    buffer = rest;
    for (const objectText of objects) {
      const trimmed = objectText.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof parsed.op === "string" &&
          typeof parsed.path === "string"
        ) {
          if (parsed.path === "/root" && typeof parsed.value === "string") {
            rootKey = parsed.value;
            rootResolved = elementKeys.has(parsed.value);
          }
          if (parsed.path.startsWith("/elements/")) {
            const key = parsed.path.slice("/elements/".length).split("/")[0];
            if (key) {
              if (!firstElementKey) firstElementKey = key;
              elementKeys.add(key);
              if (rootKey && key === rootKey) rootResolved = true;
            }
          }
          emittedPatchCount += 1;
          controller.enqueue(encoder.encode(trimmed + "\n"));
          if (!rootResolved) {
            maybeRepairRoot(controller, false);
          }
        }
      } catch {
        // Skip invalid JSON chunks
      }
    }
  };

  return new TransformStream({
    transform(chunk, controller) {
      processText(decoder.decode(chunk, { stream: true }), controller);
    },
    flush(controller) {
      processText(decoder.decode(), controller);

      const trailing = buffer.trim();
      if (trailing.startsWith("{") && trailing.endsWith("}")) {
        try {
          const parsed = JSON.parse(trailing);
          if (
            parsed &&
            typeof parsed === "object" &&
            typeof parsed.op === "string" &&
            typeof parsed.path === "string"
          ) {
            if (parsed.path === "/root" && typeof parsed.value === "string") {
              rootKey = parsed.value;
              rootResolved = elementKeys.has(parsed.value);
            }
            if (parsed.path.startsWith("/elements/")) {
              const key = parsed.path.slice("/elements/".length).split("/")[0];
              if (key) {
                if (!firstElementKey) firstElementKey = key;
                elementKeys.add(key);
                if (rootKey && key === rootKey) rootResolved = true;
              }
            }
            emittedPatchCount += 1;
            controller.enqueue(encoder.encode(trailing + "\n"));
          }
        } catch {
          // Ignore trailing parse failures
        }
      }

      if (!rootResolved) {
        maybeRepairRoot(controller, true);
      }

      if (emittedPatchCount === 0) {
        const lines = fallbackSpec.split("\n").filter(Boolean);
        for (const line of lines) {
          controller.enqueue(encoder.encode(line + "\n"));
        }
      }
    },
  });
}

export function streamFilteredSpecResponse(
  body: ReadableStream<Uint8Array> | null,
  options?: {
    status?: number;
    headers?: HeadersInit;
    fallbackSpec?: string;
    enforceRootElementMapping?: boolean;
  }
): Response {
  const status = options?.status ?? 200;
  const headers = options?.headers ?? {};
  const source =
    body ??
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

  const filtered = source.pipeThrough(
    createSpecJsonlFilterStream({
      fallbackSpec: options?.fallbackSpec,
      enforceRootElementMapping: options?.enforceRootElementMapping,
    })
  );

  return new Response(filtered, {
    status,
    headers: {
      ...SPEC_STREAM_HEADERS,
      ...headers,
    },
  });
}
