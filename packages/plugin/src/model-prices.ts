/**
 * Model price table used to estimate LLM call cost when the provider does not
 * report billing data. Prices are USD per 1M tokens; cache-read is billed at a
 * fraction of input price by convention. Kept as a static lookup so the plugin
 * stays dependency-free and the source of truth is auditable in-repo.
 *
 * Only models this deployment actually uses need entries; unknown models fall
 * back to `cost_source: "none"` rather than inventing a price.
 */

type Price = { inputPerM: number; outputPerM: number; cacheReadPerM?: number };

const PRICES: Record<string, Price> = {
  // OpenAI / Azure
  "gpt-5": { inputPerM: 1.25, outputPerM: 10 },
  "gpt-5-mini": { inputPerM: 0.25, outputPerM: 2 },
  "gpt-5-nano": { inputPerM: 0.05, outputPerM: 0.4 },
  "gpt-5.1": { inputPerM: 1.25, outputPerM: 10 },
  "gpt-5.1-mini": { inputPerM: 0.25, outputPerM: 2 },
  "gpt-5.2": { inputPerM: 1.25, outputPerM: 10 },
  "gpt-5.2-mini": { inputPerM: 0.25, outputPerM: 2 },
  "gpt-4.1": { inputPerM: 2, outputPerM: 8 },
  "gpt-4.1-mini": { inputPerM: 0.4, outputPerM: 1.6 },
  "gpt-4o": { inputPerM: 2.5, outputPerM: 10 },
  "gpt-4o-mini": { inputPerM: 0.15, outputPerM: 0.6 },
  "o3": { inputPerM: 2, outputPerM: 8 },
  "o3-mini": { inputPerM: 1.1, outputPerM: 4.4 },
  "o4-mini": { inputPerM: 1.1, outputPerM: 4.4 },
  // Anthropic
  "claude-sonnet-4.5": { inputPerM: 3, outputPerM: 15 },
  "claude-opus-4.1": { inputPerM: 15, outputPerM: 75 },
  "claude-haiku-4.5": { inputPerM: 1, outputPerM: 5 },
  "claude-3-7-sonnet": { inputPerM: 3, outputPerM: 15 },
  // DeepSeek
  "deepseek-chat": { inputPerM: 0.27, outputPerM: 1.1, cacheReadPerM: 0.07 },
  "deepseek-reasoner": { inputPerM: 0.55, outputPerM: 2.19, cacheReadPerM: 0.14 },
  "deepseek-v3": { inputPerM: 0.27, outputPerM: 1.1, cacheReadPerM: 0.07 },
  "deepseek-v4": { inputPerM: 0.27, outputPerM: 1.1, cacheReadPerM: 0.07 },
  "deepseek-v4-flash": { inputPerM: 0.07, outputPerM: 0.28, cacheReadPerM: 0.014 },
  // Gemini
  "gemini-2.5-pro": { inputPerM: 1.25, outputPerM: 10 },
  "gemini-2.5-flash": { inputPerM: 0.3, outputPerM: 2.5 },
  // Meta
  "llama-4-maverick": { inputPerM: 0.19, outputPerM: 0.56 },
  "llama-4-scout": { inputPerM: 0.12, outputPerM: 0.35 },
};

/** Match a model ref to a price entry. Tolerates provider prefixes and version suffixes. */
export function priceForModel(model: string): Price | null {
  const exact = PRICES[model];
  if (exact) return exact;
  // Try longest-prefix match so "floway-sg/deepseek-v4-flash" hits "deepseek-v4-flash".
  const keys = Object.keys(PRICES).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (model.includes(key)) return PRICES[key];
  }
  return null;
}

/** Estimate USD cost for one LLM call. Returns null when no price is known. */
export function estimateCost(input: {
  model: string; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number;
}): number | null {
  const price = priceForModel(input.model);
  if (!price) return null;
  const inputCost = (input.inputTokens || 0) / 1_000_000 * price.inputPerM;
  const outputCost = (input.outputTokens || 0) / 1_000_000 * price.outputPerM;
  const cacheReadCost = (input.cacheReadTokens || 0) / 1_000_000 * (price.cacheReadPerM ?? price.inputPerM * 0.1);
  // Cache-write is conventionally billed at ~1.25x input; approximate when unknown.
  const cacheWriteCost = (input.cacheWriteTokens || 0) / 1_000_000 * (price.cacheReadPerM ? price.inputPerM * 1.25 : price.inputPerM * 1.25);
  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}
