import type { CoveRestClient } from "./rest-client.js";
import { estimateCost } from "./model-prices.js";

/**
 * Collects per-call LLM usage from OpenClaw's `llm_output` hook and attributes
 * it to the Cove run that owns the session. OpenClaw's native runId is NOT the
 * Cove run id — the Cove plugin creates its own run per turn. The mapping is:
 *
 *   llm_output ctx.sessionKey → Cove thread session key → Cove run id
 *   (bound in the agent-run-lifecycle bridge when dispatch starts the turn).
 *
 * Subagent calls carry their child session key; the lifecycle bridge tracks
 * child → parent session keys, so usage for children is attributed to the
 * parent Cove run and rolled up server-side via parent_run_id.
 *
 * The hook is fire-and-forget (runs in parallel). All reporting is queued and
 * failures are logged, never thrown — observability must not break the turn.
 */
type LlmOutputEvent = {
  runId: string;
  sessionId: string;
  provider: string;
  model: string;
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
};
type LlmOutputContext = { sessionKey?: string; sessionId?: string; runId?: string };

/** Bridge subset the collector needs: run attribution + per-run REST client. */
export interface UsageBridge {
  runForSession(sessionKey: string): string | null;
  parentSessionFor(sessionKey: string): string | null;
  restForSession(sessionKey: string): Pick<CoveRestClient, "recordRunUsage"> | null;
}

export class CoveUsageCollector {
  constructor(
    private readonly bridge: UsageBridge,
    private readonly log?: { warn?: (msg: string) => void },
  ) {}

  onLlmOutput(event: LlmOutputEvent, ctx: LlmOutputContext): void {
    const usage = event.usage;
    if (!usage) return;
    const tokens = (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
    if (tokens <= 0) return;

    // Attribute through the session chain: a child session resolves to its
    // parent Cove run; a direct session resolves to its own run.
    const sessionKey = ctx.sessionKey ?? ctx.sessionId;
    if (!sessionKey) return;
    let runId = this.bridge.runForSession(sessionKey);
    let rest = this.bridge.restForSession(sessionKey);
    if (!runId || !rest) {
      const parent = this.bridge.parentSessionFor(sessionKey);
      if (parent) {
        runId = this.bridge.runForSession(parent);
        rest = this.bridge.restForSession(parent);
      }
    }
    if (!runId || !rest) return;

    const cost = estimateCost({
      model: event.model,
      inputTokens: usage.input ?? 0,
      outputTokens: usage.output ?? 0,
      cacheReadTokens: usage.cacheRead ?? 0,
      cacheWriteTokens: usage.cacheWrite ?? 0,
    });

    rest.recordRunUsage(runId, {
      provider: event.provider,
      model: event.model,
      input_tokens: usage.input ?? 0,
      output_tokens: usage.output ?? 0,
      cache_read_tokens: usage.cacheRead ?? 0,
      cache_write_tokens: usage.cacheWrite ?? 0,
      cost,
      cost_source: cost === null ? "none" : "price_table",
    }).catch((error) => this.log?.warn?.(`cove: failed to record run usage: ${error?.message ?? error}`));
  }
}
