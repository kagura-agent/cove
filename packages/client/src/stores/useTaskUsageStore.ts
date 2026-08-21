import { create } from "zustand";
import type { AgentRunUsage } from "@cove/shared";
import * as api from "../lib/api";
import { dispatcher } from "../lib/gateway-dispatcher";

interface TaskUsageState {
  /** channelId → (taskId → usage rollup). One shared cache per channel. */
  byChannel: Record<string, Record<string, AgentRunUsage>>;
  /** Fetch a channel's per-task usage rollups. Deduped in-flight and cached:
   *  a second call for a channel that is already cached or fetching is a no-op.
   *  Callers that need fresh data invalidate first (see invalidateChannel). */
  fetchChannel: (channelId: string) => Promise<void>;
  /** Drop a channel's cached rollups (and any in-flight guard), so the next
   *  fetchChannel actually refetches. */
  invalidateChannel: (channelId: string) => void;
}

const inFlight = new Set<string>();

export const useTaskUsageStore = create<TaskUsageState>((set, get) => ({
  byChannel: {},

  fetchChannel: async (channelId) => {
    // Already cached or in flight — nothing to do. This makes repeated calls
    // (e.g. from an effect that re-runs) idempotent, so component code never
    // has to reason about effect churn or fetch races.
    if (get().byChannel[channelId]) return;
    if (inFlight.has(channelId)) return;
    inFlight.add(channelId);
    try {
      const usages = await api.fetchTaskUsages(channelId);
      set((s) => ({ byChannel: { ...s.byChannel, [channelId]: usages } }));
    } catch (err) {
      console.error("fetch task usages:", err);
    } finally {
      inFlight.delete(channelId);
    }
  },

  invalidateChannel: (channelId) => {
    inFlight.delete(channelId);
    set((s) => {
      if (!s.byChannel[channelId]) return s;
      const { [channelId]: _, ...rest } = s.byChannel;
      return { byChannel: rest };
    });
  },
}));

// Live-refresh: usage events invalidate + refetch the affected channel so
// every consumer (guild task board, inline channel task list) tracks a running
// agent without each component wiring its own dispatcher subscription.
dispatcher.on("AGENT_USAGE_UPDATED", (run) => {
  if (!run?.channel_id) return;
  const s = useTaskUsageStore.getState();
  s.invalidateChannel(run.channel_id);
  void s.fetchChannel(run.channel_id);
});
