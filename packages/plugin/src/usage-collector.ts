import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { CoveRestClient } from "./rest-client.js";

/** Persistent baseline store path. Survives gateway restarts so the first
 * turn after a restart is reported instead of silently establishing a new
 * baseline. Overridable for tests / custom state dirs. */
const STATE_FILE = process.env.COVE_USAGE_STATE_FILE ?? join(homedir(), ".openclaw", "state", "cove-usage-baselines.json");

/**
 * Collects per-turn LLM usage from OpenClaw's `agent_end` hook and attributes
 * it to the Cove run that owns the session.
 *
 * Data source: `agent_end` fires on every completed turn (channel turns
 * included) and its `messages` array carries per-call `usage` on each assistant
 * message. The message list is cumulative across the session, so this collector
 * keeps a per-session baseline and reports the *delta* (new usage since the
 * last observed end) — that delta is exactly the current turn's consumption.
 *
 * Cost policy: **trust the reported data**. OpenClaw's per-call usage carries
 * `cost` (provider-billed or model-config-derived); whatever it reports — even
 * 0 — is recorded as-is. No local price table fallback: an invented price would
 * silently corrupt ROI/cache-rate analytics. When cost is absent, it is stored
 * as null with cost_source "none".
 *
 * Attribution: OpenClaw's native runId is NOT the Cove run id — the Cove
 * plugin creates its own run per turn. Mapping:
 *
 *   hook sessionKey → Cove thread session key → Cove run id
 *   (bound in the agent-run-lifecycle bridge when dispatch starts the turn).
 *
 * Subagent turns carry their child session key; the lifecycle bridge tracks
 * child → parent session keys, so child usage is attributed to the parent run.
 *
 * The hook is fire-and-forget. All reporting is queued and failures are
 * logged, never thrown — observability must not break the turn.
 */
type MsgUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
};
type AgentEndEvent = {
  runId?: string;
  messages: Array<{ role?: string; provider?: string; model?: string; usage?: MsgUsage }>;
  success: boolean;
  error?: string;
  durationMs?: number;
};
type AgentEndContext = { sessionKey?: string; sessionId?: string; runId?: string };
type TokenTotals = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; hasCost: boolean };

function sumUsage(messages: Array<{ usage?: MsgUsage }>): TokenTotals {
  const totals: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, hasCost: false };
  for (const m of messages) {
    const u = m.usage;
    if (!u) continue;
    totals.input += u.input ?? 0;
    totals.output += u.output ?? 0;
    totals.cacheRead += u.cacheRead ?? 0;
    totals.cacheWrite += u.cacheWrite ?? 0;
    if (u.cost && typeof u.cost.total === "number") {
      totals.cost += u.cost.total;
      totals.hasCost = true;
    }
  }
  return totals;
}

function lastModel(messages: Array<{ role?: string; provider?: string; model?: string; usage?: MsgUsage }>): { provider: string; model: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.usage && m.model) return { provider: m.provider ?? "unknown", model: m.model };
  }
  return null;
}

/** Bridge subset the collector needs: run attribution + per-run REST client. */
export interface UsageBridge {
  runForSession(sessionKey: string): string | null;
  parentSessionFor(sessionKey: string): string | null;
  restForSession(sessionKey: string): Pick<CoveRestClient, "recordRunUsage"> | null;
}

export class CoveUsageCollector {
  /** Per-session cumulative token/cost baseline (for delta computation). */
  private baselines = new Map<string, TokenTotals>();

  constructor(
    private readonly bridge: UsageBridge,
    private readonly log?: { warn?: (msg: string) => void },
    private readonly stateFile = STATE_FILE,
  ) {
    this.loadBaselines();
  }

  private loadBaselines(): void {
    try {
      if (!existsSync(this.stateFile)) return;
      const raw = JSON.parse(readFileSync(this.stateFile, "utf8")) as Record<string, TokenTotals>;
      for (const [key, value] of Object.entries(raw)) {
        if (value && typeof value === "object") this.baselines.set(key, value);
      }
      this.log?.warn?.(`cove: restored ${this.baselines.size} usage baseline(s) from ${this.stateFile}`);
    } catch (error) {
      this.log?.warn?.(`cove: failed to load usage baselines: ${(error as Error)?.message ?? String(error)}`);
    }
  }

  private persistBaselines(): void {
    try {
      mkdirSync(this.stateFile.substring(0, this.stateFile.lastIndexOf("/")), { recursive: true });
      writeFileSync(this.stateFile, JSON.stringify(Object.fromEntries(this.baselines)), { mode: 0o600 });
    } catch (error) {
      this.log?.warn?.(`cove: failed to persist usage baselines: ${(error as Error)?.message ?? String(error)}`);
    }
  }

  onAgentEnd(event: AgentEndEvent, ctx: AgentEndContext): void {
    const sessionKey = ctx.sessionKey ?? ctx.sessionId;
    if (!sessionKey) return;
    const totals = sumUsage(event.messages ?? []);
    const baseline = this.baselines.get(sessionKey);
    if (!baseline) {
      // First observed end for this session: record the baseline without
      // reporting (the messages include pre-existing history).
      this.baselines.set(sessionKey, totals);
      this.persistBaselines();
      return;
    }
    const delta: TokenTotals = {
      input: totals.input - baseline.input,
      output: totals.output - baseline.output,
      cacheRead: totals.cacheRead - baseline.cacheRead,
      cacheWrite: totals.cacheWrite - baseline.cacheWrite,
      cost: totals.cost - baseline.cost,
      hasCost: totals.hasCost,
    };
    this.baselines.set(sessionKey, totals);
    this.persistBaselines();
    if (delta.input <= 0 && delta.output <= 0 && delta.cacheRead <= 0 && delta.cacheWrite <= 0) {
      return;
    }

    // Attribute through the session chain (child → parent Cove run).
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

    const modelInfo = lastModel(event.messages ?? []);
    const model = modelInfo?.model ?? "unknown";
    const provider = modelInfo?.provider ?? "unknown";

    rest.recordRunUsage(runId, {
      provider,
      model,
      input_tokens: delta.input,
      output_tokens: delta.output,
      cache_read_tokens: delta.cacheRead,
      cache_write_tokens: delta.cacheWrite,
      // Trust the reported cost: use it as-is (0 stays 0), null when absent.
      cost: delta.hasCost ? delta.cost : null,
      cost_source: delta.hasCost ? "provider" : "none",
    }).catch((error) => this.log?.warn?.(`cove: failed to record run usage: ${error?.message ?? error}`));
  }
}
