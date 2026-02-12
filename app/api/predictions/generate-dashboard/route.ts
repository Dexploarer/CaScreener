import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { PredictionMarket, ArbitrageOpportunity } from "@/lib/predictions/types";
import {
  buildStatusSpec,
  streamFilteredSpecResponse,
  streamSpec,
} from "@/lib/specstream/stream";

export const maxDuration = 30;

const ROUTE_FALLBACK_SPEC = buildStatusSpec(
  "Structured UI Fallback",
  "Recovered from unstructured model output",
  "Re-run this dashboard prompt for a richer render."
);

function streamRouteStatus(
  title: string,
  description: string,
  note = "Try again in a moment."
): Response {
  return streamSpec(buildStatusSpec(title, description, note));
}

const SERVER_SYSTEM_PROMPT = `# Component Catalog (SpecStream)

## Available Components
- Card: title (string), description (string|null). Container with optional title.
- Button: label (string), action (string|null), params (object|null). Use action "navigate" for links; handler will open URL.
- Text: content (string). Text paragraph.
- Stack: gap ("sm"|"md"|"lg"), direction ("vertical"|"horizontal"). Layout. Slots: default.
- Metric: label (string), value (string), format ("currency"|"percent"|"number"|null).
- TextField: label, valuePath, placeholder, checks, validateOn.

## Rules
- Output valid SpecStream JSONL: one JSON object per line.
- Each line: { "op": "add" or "replace", "path": "/path", "value": ... }. Use "replace" for /root.
- Start with replace /root then add /elements/*. Use keys like card-1, text-1, button-1, metric-1.
- Only use the components listed above.`;

function getModel(provider: string) {
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (provider === "anthropic" && anthropicKey) {
    return { provider: "anthropic" as const, key: anthropicKey };
  }
  if (openaiKey) {
    return { provider: "openai" as const, key: openaiKey };
  }
  if (anthropicKey) {
    return { provider: "anthropic" as const, key: anthropicKey };
  }
  return null;
}

function summarizeMarkets(markets: PredictionMarket[]): string {
  if (markets.length === 0) return "(no markets)";
  return markets
    .slice(0, 15)
    .map(
      (m) =>
        `- ${m.question} (${m.platform}): YES ${(m.yesPrice * 100).toFixed(1)}% | NO ${(m.noPrice * 100).toFixed(1)}% | Vol: ${m.volume?.toLocaleString() ?? "—"} | ${m.url ?? ""}`
    )
    .join("\n");
}

function summarizeOpportunities(opps: ArbitrageOpportunity[]): string {
  if (opps.length === 0) return "(no opportunities)";
  return opps
    .slice(0, 10)
    .map(
      (o) =>
        `- ${o.question}: implied profit ${o.impliedProfit != null ? (o.impliedProfit * 100).toFixed(2) : "—"}% | ${o.markets.map((m) => `${m.platform} YES ${(m.yesPrice * 100).toFixed(1)}%`).join(", ")}`
    )
    .join("\n");
}

export async function POST(req: Request) {
  const { rateLimit: rateLimitFn, getClientIdentifier } = await import("@/lib/rate-limit");
  const id = getClientIdentifier(req);
  const limiter = rateLimitFn(id, "predictions-generate");
  if (!limiter.ok) {
    const retryAfter = Math.ceil(limiter.resetIn / 1000);
    return streamRouteStatus(
      "Rate Limited",
      `Too many dashboard generation requests. Retry after ${retryAfter}s.`
    );
  }

  let body: {
    markets?: PredictionMarket[];
    opportunities?: ArbitrageOpportunity[];
    followUpPrompt?: string;
    currentSpec?: { root?: string; elements?: Record<string, unknown> };
    provider?: string;
  };
  try {
    body = await req.json();
  } catch {
    return streamRouteStatus(
      "Invalid Request",
      "The request body could not be parsed as JSON."
    );
  }

  const followUpPrompt = typeof body.followUpPrompt === "string" ? body.followUpPrompt.trim() : undefined;
  const currentSpec = body.currentSpec && typeof body.currentSpec === "object" ? body.currentSpec : undefined;
  const markets = Array.isArray(body.markets) ? body.markets : [];
  const opportunities = Array.isArray(body.opportunities) ? body.opportunities : [];

  const provider = body.provider ?? "openai";
  const modelConfig = getModel(provider);
  if (!modelConfig) {
    return streamRouteStatus(
      "AI Provider Missing",
      "Set OPENAI_API_KEY or ANTHROPIC_API_KEY for generated dashboards."
    );
  }

  const marketsBlock = summarizeMarkets(markets);
  const oppsBlock = summarizeOpportunities(opportunities);
  const contextBlock = `## Markets (${markets.length} total)\n${marketsBlock}\n\n## Arbitrage opportunities (${opportunities.length} total)\n${oppsBlock}`;

  const initialPrompt = `Create a prediction markets dashboard as SpecStream JSONL.

Data:
${contextBlock}

Requirements:
- Use a Card as root with title like "Prediction Markets Dashboard" and a short description.
- Include Metrics for: total markets count, total arbitrage opportunities count, top implied profit % if any.
- Include a Text summarizing the key insights (e.g. top spreads, notable markets).
- For each arbitrage opportunity with implied profit > 2%, include a Button with label "View on [platform]", action "navigate", and params {"url":"<market-url>"} when available.
- Use Stack with vertical layout and gap "md" to organize content.
Output only the JSONL lines, no other text.`;

  const userPrompt = followUpPrompt
    ? `The user wants a refined or different view of the same data. Their request: "${followUpPrompt}"

Data (same as before):
${contextBlock}
${currentSpec?.root ? `\nCurrent dashboard spec (for reference; you may replace it entirely):\n${JSON.stringify(currentSpec)}` : ""}

Create an updated SpecStream JSONL that fulfills the user's request. Use only Card, Stack, Text, Metric, Button. Output only the JSONL lines, no other text.`
    : initialPrompt;

  const systemPrompt = SERVER_SYSTEM_PROMPT;

  try {
    if (modelConfig.provider === "openai") {
      const openai = createOpenAI({ apiKey: modelConfig.key });
      const result = streamText({
        model: openai("gpt-4o-mini"),
        system: systemPrompt,
        prompt: userPrompt,
      });
      const textStream = result.toTextStreamResponse();
      return streamFilteredSpecResponse(textStream.body, {
        fallbackSpec: ROUTE_FALLBACK_SPEC,
      });
    }

    const anthropic = createAnthropic({ apiKey: modelConfig.key });
    const result = streamText({
      model: anthropic("claude-3-5-haiku-20241022"),
      system: systemPrompt,
      prompt: userPrompt,
    });
    const textStream = result.toTextStreamResponse();
    return streamFilteredSpecResponse(textStream.body, {
      fallbackSpec: ROUTE_FALLBACK_SPEC,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected model invocation failure.";
    return streamRouteStatus("Generation Failed", message);
  }
}
