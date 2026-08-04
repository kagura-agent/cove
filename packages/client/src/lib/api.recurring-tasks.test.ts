import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRecurringTask,
  deleteRecurringTask,
  fetchRecurringTasks,
  updateRecurringTask,
} from "./api";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const template = {
  id: "recurring-1",
  guild_id: "guild-1",
  channel_id: "channel-1",
  title: "Review inbox",
  description: "",
  assignee_id: null,
  created_by: "user-1",
  schedule_type: "interval" as const,
  interval_ms: 3_600_000,
  enabled: true,
  last_task_id: null,
  last_spawned_at: 0,
  heartbeat_interval_ms: 0,
  created_at: 0,
  updated_at: 0,
};

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

describe("recurring task API", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse(template));
  });

  it("creates a recurring template with its schedule", async () => {
    await createRecurringTask("channel-1", {
      title: "Review inbox",
      schedule_type: "interval",
      interval_ms: 3_600_000,
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v10/channels/channel-1/recurring-tasks", expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({
        title: "Review inbox",
        schedule_type: "interval",
        interval_ms: 3_600_000,
      }),
    }));
  });

  it("lists and manages channel recurring templates", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([template]))
      .mockResolvedValueOnce(jsonResponse({ ...template, enabled: false }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }));

    await expect(fetchRecurringTasks("channel-1")).resolves.toEqual([template]);
    await updateRecurringTask("recurring-1", { enabled: false });
    await expect(deleteRecurringTask("recurring-1")).resolves.toEqual({ deleted: true });

    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v10/recurring-tasks/recurring-1", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/v10/recurring-tasks/recurring-1", expect.objectContaining({ method: "DELETE" }));
  });
});
