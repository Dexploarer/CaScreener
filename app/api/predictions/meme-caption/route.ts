import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { ArbitrageOpportunity, PredictionMarket } from "@/lib/predictions/types";

export const maxDuration = 15;

type Body = {
  opportunity?: ArbitrageOpportunity;
  market?: PredictionMarket;
  tone?: "default" | "degen";
};

function summarizeOpportunity(opp: ArbitrageOpportunity): string {
  const legs = opp.markets
    .map(
      (m) => `[${m.platform}] YES ${(m.yesPrice * 100).toFixed(1)}%, NO ${(m.noPrice * 100).toFixed(1)}%, vol=${m.volume ?? 0}`
    )
    .join(" | ");
  const profit =
    opp.impliedProfit != null ? `Implied edge: ${(opp.impliedProfit * 100).toFixed(2)}%` : "Implied edge: –";
  return `Question: ${opp.question}\n${legs}\n${profit}`;
}

function summarizeMarket(m: PredictionMarket): string {
  return `Market: ${m.question}\n[${m.platform}] YES ${(m.yesPrice * 100).toFixed(1)}%, NO ${(m.noPrice * 100).toFixed(
    1
  )}%, vol=${m.volume ?? 0}${m.endDate ? `, closes ${m.endDate}` : ""}`;
}

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

export async function POST(req: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const opportunity = body.opportunity;
  const market = body.market;
  if (!opportunity && !market) {
    return Response.json({ error: "Provide either 'opportunity' or 'market' in the request body." }, { status: 400 });
  }

  const providerPref = "openai";
  const modelConfig = getModel(providerPref);
  if (!modelConfig) {
    return Response.json(
      { error: "No AI provider configured (OPENAI_API_KEY or ANTHROPIC_API_KEY)" },
      { status: 503 }
    );
  }

  const tone = body.tone === "degen" ? "degen" : "default";
  const baseDescription = opportunity ? summarizeOpportunity(opportunity) : summarizeMarket(market as PredictionMarket);

  const instructions =
    tone === "degen"
      ? `You are a crypto degen shitposter. Given a prediction market or arbitrage opportunity, write 3 short, high-energy meme captions suitable for X / Farcaster. Use casual crypto slang, playful tone, emojis allowed, but no slurs or hate. Each caption must be under 180 characters. Output ONLY a JSON array of 3 strings, e.g.: ["caption 1", "caption 2", "caption 3"].`
      : `You are a witty but responsible analyst. Given a prediction market or arbitrage opportunity, write 3 short, punchy captions suitable for social media. Highlight the interesting angle and the key numbers. Light humor is OK, but include no financial advice. Each caption must be under 180 characters. Output ONLY a JSON array of 3 strings, e.g.: ["caption 1", "caption 2", "caption 3"].`;

  const fullPrompt = `${instructions}\n\nDATA:\n${baseDescription}`;

  if (modelIsOpenAI(modelConfig)) {
    const openai = createOpenAI({ apiKey: modelConfig.key });
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: fullPrompt,
    });
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) throw new Error("Not array");
      return Response.json({ captions: parsed });
    } catch {
      // Fallback: single caption wrapped in array
      return Response.json({ captions: [text.trim()] });
    }
  }

  const anthropic = createAnthropic({ apiKey: modelConfig.key });
  const { text } = await generateText({
    model: anthropic("claude-3-5-haiku-20241022"),
    prompt: fullPrompt,
  });
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) throw new Error("Not array");
    return Response.json({ captions: parsed });
  } catch {
    return Response.json({ captions: [text.trim()] });
  }
}

function modelIsOpenAI(
  cfg: { provider: "openai" | "anthropic"; key: string }
): cfg is { provider: "openai"; key: string } {
  return cfg.provider === "openai";
}

