/**
 * Helius page types. Shared lookup types re-exported from lib; UGI-specific types here.
 */

export type {
  LookupType,
  LookupResult,
  WalletLookupResult,
  TransactionLookupResult,
  TokenLookupResult,
  NftLookupResult,
  WalletAnalyticsShape,
  AlliumEnrichmentShape,
} from "@/lib/helius/types";

/** UI alias: wallet analytics shape (same as WalletAnalyticsShape). */
export type { WalletAnalyticsShape as WalletAnalytics } from "@/lib/helius/types";

export type UgiSpecShape = { root: string; elements: Record<string, unknown> };
export type UgiElementDesc = { type: string; props: Record<string, unknown>; children: string[] };
export type UgiSpecFlat = { root: string; elements: Record<string, UgiElementDesc> };
export type UgiElementLike = { type?: string; props?: Record<string, unknown>; children?: string[] };
export type ValidatorMap = Record<string, (v: unknown) => boolean>;
