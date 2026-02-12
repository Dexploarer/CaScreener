"use node";

import { v } from "convex/values";
import { api } from "./_generated/api";
import { action } from "./_generated/server";

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

async function sendDiscordAlert(
  webhookUrl: string | undefined,
  message: string
): Promise<boolean> {
  if (!webhookUrl) return false;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function sendTelegramAlert(
  chatId: string | undefined,
  message: string
): Promise<boolean> {
  if (!chatId) return false;
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const evaluateTokenForAlerts = action({
  args: {
    symbol: v.string(),
    mint: v.string(),
    suspiciousTickerCount: v.number(),
    sameTickerCount: v.number(),
    trustScore: v.optional(v.union(v.number(), v.null())),
    pairUrl: v.optional(v.string()),
    explorerUrl: v.optional(v.string()),
  },
  returns: v.object({
    processed: v.number(),
  }),
  handler: async (ctx: any, args: any) => {
    const ticker = normalizeTicker(args.symbol);
    const suspicious = Math.max(0, args.suspiciousTickerCount);
    const total = Math.max(0, args.sameTickerCount);
    const watchers = (await ctx.runQuery(api.watchlists.listActiveByTicker, {
      ticker,
    })) as Array<any>;

    let processed = 0;
    for (const watch of watchers) {
      const previous = watch.lastSeenSuspicious ?? 0;
      const shouldAlert = suspicious > previous;
      if (!shouldAlert) continue;

      const msg = `${ticker} clone alert: suspicious listings ${previous} -> ${suspicious} (total ${total}). Mint ${args.mint}. ${args.explorerUrl ?? ""}`.trim();
      const [telegram, discord] = await Promise.all([
        sendTelegramAlert(watch.telegramChatId, msg),
        sendDiscordAlert(watch.discordWebhookUrl, msg),
      ]);

      const channels: string[] = [];
      if (watch.web) channels.push("web");
      if (watch.telegramChatId) channels.push("telegram");
      if (watch.discordWebhookUrl) channels.push("discord");

      await ctx.runMutation(api.watchlists.recordAlert, {
        watchlistId: String(watch._id),
        userId: watch.userId,
        ticker,
        mint: args.mint,
        previousSuspicious: previous,
        currentSuspicious: suspicious,
        message: msg,
        channels,
        delivered: {
          web: !!watch.web,
          telegram,
          discord,
        },
        trustScore:
          typeof args.trustScore === "number" ? args.trustScore : undefined,
        pairUrl: args.pairUrl,
        explorerUrl: args.explorerUrl,
      });

      processed += 1;
    }

    return { processed };
  },
});

