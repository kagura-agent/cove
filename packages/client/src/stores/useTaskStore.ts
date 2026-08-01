import { create } from "zustand";
import type { Task } from "@cove/shared";
import * as api from "../lib/api";
import { dispatcher } from "../lib/gateway-dispatcher";

interface TaskState {
  byTaskId: Record<string, Task>;
  upsertTask: (task: Task) => void;
  getTasksForChannel: (channelId: string) => Task[];
  fetchTasks: (channelId: string) => Promise<void>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  byTaskId: {},

  upsertTask: (task) => {
    set((s) => {
      const existing = s.byTaskId[task.task_id];
      if (existing && existing.updated_at > task.updated_at) return s;
      return { byTaskId: { ...s.byTaskId, [task.task_id]: task } };
    });
  },

  getTasksForChannel: (channelId) => {
    return Object.values(get().byTaskId).filter((t) => t.channel_id === channelId);
  },

  fetchTasks: async (channelId) => {
    try {
      const tasks = await api.fetchTasks(channelId);
      for (const task of tasks) {
        get().upsertTask(task);
      }
    } catch (err) {
      console.error("fetch tasks:", err);
    }
  },
}));

dispatcher.on("TASK_CREATED", (task) => useTaskStore.getState().upsertTask(task));
dispatcher.on("TASK_UPDATED", (task) => useTaskStore.getState().upsertTask(task));
