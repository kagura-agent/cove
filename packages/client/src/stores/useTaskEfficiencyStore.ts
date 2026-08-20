import { create } from "zustand";
import type { TaskEfficiencyReport } from "@cove/shared";
import * as api from "../lib/api";

interface TaskEfficiencyState {
  /** channelId → (taskId → report). One shared channel baseline per channel. */
  byChannel: Record<string, Record<string, TaskEfficiencyReport>>;
  /** Fetch (once per channel, deduped) the channel-wide efficiency report used
   *  as the shared baseline for row-level health lines on the task board. */
  fetchChannel: (channelId: string) => Promise<void>;
  /** Invalidate a channel's cached reports (e.g. after a usage event). */
  invalidateChannel: (channelId: string) => void;
}

const inFlight = new Set<string>();

export const useTaskEfficiencyStore = create<TaskEfficiencyState>((set) => ({
  byChannel: {},

  fetchChannel: async (channelId) => {
    if (inFlight.has(channelId)) return;
    inFlight.add(channelId);
    try {
      const reports = await api.fetchChannelTaskEfficiency(channelId);
      const byTask: Record<string, TaskEfficiencyReport> = {};
      for (const report of reports) byTask[report.task_id] = report;
      set((s) => ({ byChannel: { ...s.byChannel, [channelId]: byTask } }));
    } catch (err) {
      console.error("fetch channel efficiency:", err);
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
