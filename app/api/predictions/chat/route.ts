import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { PredictionMarket, ArbitrageOpportunity } from "@/lib/predictions/types";

export const maxDuration = 30;

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

type Body = {
  messages: ChatMessage[];
  context?: {
    markets?: PredictionMarket[];
    opportunities?: ArbitrageOpportunity[];
  };
};

const SYSTEM_PROMPT = `You are an expert prediction markets assistant. When users ask to filter or show only certain markets (e.g. "only crypto", "high volume", "politics"), you should both:
- Clearly explain what you are doing in natural language, and
- Optionally output a single structured intent line at the very end of your reply to let the client update filters.

Structured intent protocol:
- If you want the UI to filter markets, append a FINAL line in this exact format (on its own line):
  INTENT: {"action":"filterMarkets","criteria":{"query":"crypto","platform":"all"}}
- If you want the UI to change arbitrage scanning thresholds, append a FINAL line like:
  INTENT: {"action":"filterArbitrage","criteria":{"minSpread":0.03}}
- Use "platform" only as "all", "polymarket", or "manifold".
- If no filter or view change is needed, DO NOT output any INTENT line at all.
- Never output more than one INTENT line.
- Keep all natural language explanation ABOVE the INTENT line.

You can see cross-platform markets (Polymarket, Manifold) and potential arbitrage opportunities.

Guidelines:
- Explain prices as probabilities (e.g. 0.63 ~ 63%).
- When asked about arbitrage, look for pairs where buying YES on one venue and NO on another sums to < 1.
- Always call out practical risks: execution latency, slippage, limits, fees, regulatory restrictions.
- Do NOT give personal investment advice; provide analysis, not guarantees.
- When comparing markets, mention platform, yes/no prices, volume, and close date if available.
`;

export async function POST(req: Request): Promise<Response> {
  const { rateLimit, getClientIdentifier } = await import("@/lib/rate-limit");
  const id = getClientIdentifier(req);
  const limiter = rateLimit(id, "predictions-chat");
  if (!limiter.ok) {
    return Response.json(
      { error: "Too many requests", retryAfter: Math.ceil(limiter.resetIn / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limiter.resetIn / 1000)) } }
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const provider = openaiKey ? "openai" : anthropicKey ? "anthropic" : null;

  if (!provider) {
    return Response.json(
      {
        error:
          "No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY to enable prediction chat.",
      },
      { status: 503 }
    );
  }

  const history = Array.isArray(body.messages) ? body.messages : [];
  const userPrompt =
    history.length > 0
      ? history
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .join("\n")
      : "Explain what prediction markets and arbitrage opportunities are.";

  const contextLines: string[] = [];
  const ctx = body.context;
  if (ctx?.markets && ctx.markets.length > 0) {
    contextLines.push(
      "Markets:",
      ...ctx.markets.slice(0, 20).map(
        (m) =>
          `- [${m.platform}] ${m.question} :: YES=${(m.yesPrice * 100).toFixed(
            1
          )}%, NO=${(m.noPrice * 100).toFixed(1)}%, volume=${m.volume ?? 0}${
            m.endDate ? `, closes ${m.endDate}` : ""
          }`
      )
    );
  }
  if (ctx?.opportunities && ctx.opportunities.length > 0) {
    contextLines.push(
      "",
      "Arbitrage candidates:",
      ...ctx.opportunities.slice(0, 20).map((o) => {
        const legs = o.markets
          .map(
            (m) =>
              `[${m.platform}] YES=${(m.yesPrice * 100).toFixed(
                1
              )}%, NO=${(m.noPrice * 100).toFixed(1)}%`
          )
          .join(" | ");
        const profit =
          o.impliedProfit != null ? `, implied profit ~ ${(o.impliedProfit * 100).toFixed(2)}%` : "";
        return `- ${o.question} :: ${legs}${profit}`;
      })
    );
  }

  const fullPrompt =
    SYSTEM_PROMPT +
    "\n\n" +
    (contextLines.length ? contextLines.join("\n") + "\n\n" : "") +
    "Conversation:\n" +
    userPrompt +
    "\n\nRespond clearly, with numbers and caveats where relevant.";

  if (provider === "openai" && openaiKey) {
    const openai = createOpenAI({ apiKey: openaiKey });
    const result = streamText({
      model: openai("gpt-4o-mini"),
      prompt: fullPrompt,
    });
    return result.toTextStreamResponse();
  }

  if (provider === "anthropic" && anthropicKey) {
    const anthropic = createAnthropic({ apiKey: anthropicKey });
    const result = streamText({
      model: anthropic("claude-3-5-haiku-20241022"),
      prompt: fullPrompt,
      system: "You are an expert prediction markets and arbitrage analyst.",
    });
    return result.toTextStreamResponse();
  }

  return Response.json({ error: "No provider" }, { status: 500 });
}

