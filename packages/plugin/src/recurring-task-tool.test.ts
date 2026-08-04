import { beforeEach, describe, expect, it, vi } from "vitest";

const { restClient } = vi.hoisted(() => ({
  restClient: {
    createRecurringTask: vi.fn(),
    getRecurringTasks: vi.fn(),
    getRecurringTask: vi.fn(),
    updateRecurringTask: vi.fn(),
    deleteRecurringTask: vi.fn(),
  },
}));

vi.mock("./channel.js", () => ({
  resolveAccount: () => ({ baseUrl: "https://cove.test", token: "token" }),
  getRestClient: () => restClient,
}));

import { createCoveTaskTool } from "./cove-task-tool.js";

describe("cove_task recurring actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps recurring actions to recurring REST methods", async () => {
    restClient.createRecurringTask.mockResolvedValue({ id: "recurring-1" });
    restClient.getRecurringTasks.mockResolvedValue([{ id: "recurring-1" }]);
    restClient.getRecurringTask.mockResolvedValue({ id: "recurring-1" });
    restClient.updateRecurringTask.mockResolvedValue({ id: "recurring-1", enabled: false });
    restClient.deleteRecurringTask.mockResolvedValue(undefined);
    const tool = createCoveTaskTool({ cfg: {} });

    const create = await tool.execute("call-1", {
      action: "recurring_create",
      channelId: "channel-1",
      title: "Daily report",
      scheduleType: "interval",
      intervalMs: 60_000,
      assigneeId: "agent-1",
      heartbeatIntervalMs: 30_000,
    });
    expect(create.details).toMatchObject({ ok: true, action: "recurring_create" });
    expect(restClient.createRecurringTask).toHaveBeenCalledWith("channel-1", expect.objectContaining({
      title: "Daily report", schedule_type: "interval", interval_ms: 60_000, assignee_id: "agent-1", heartbeat_interval_ms: 30_000,
    }));

    const list = await tool.execute("call-2", { action: "recurring_list", channelId: "channel-1" });
    expect(list.details).toMatchObject({ ok: true, action: "recurring_list" });
    expect(restClient.getRecurringTasks).toHaveBeenCalledWith("channel-1");

    const get = await tool.execute("call-3", { action: "recurring_get", recurringTaskId: "recurring-1" });
    expect(get.details).toMatchObject({ ok: true, action: "recurring_get" });
    expect(restClient.getRecurringTask).toHaveBeenCalledWith("recurring-1");

    const update = await tool.execute("call-4", { action: "recurring_update", recurringTaskId: "recurring-1", enabled: false, scheduleType: "on_complete" });
    expect(update.details).toMatchObject({ ok: true, action: "recurring_update" });
    expect(restClient.updateRecurringTask).toHaveBeenCalledWith("recurring-1", expect.objectContaining({ enabled: false, schedule_type: "on_complete" }));

    const remove = await tool.execute("call-5", { action: "recurring_delete", recurringTaskId: "recurring-1" });
    expect(remove.details).toMatchObject({ ok: true, action: "recurring_delete" });
    expect(restClient.deleteRecurringTask).toHaveBeenCalledWith("recurring-1");
  });

  it("reports recurring action validation errors before delegating", async () => {
    const tool = createCoveTaskTool({ cfg: {} });

    const missingChannel = await tool.execute("call-1", { action: "recurring_create", title: "Daily", scheduleType: "on_complete" });
    expect(missingChannel.details).toEqual({ ok: false, error: "channelId is required for recurring_create" });

    const missingTemplate = await tool.execute("call-2", { action: "recurring_get" });
    expect(missingTemplate.details).toEqual({ ok: false, error: "recurringTaskId is required for recurring_get" });

    const invalidInterval = await tool.execute("call-3", { action: "recurring_create", channelId: "channel-1", title: "Daily", scheduleType: "interval", intervalMs: 0 });
    expect(invalidInterval.details).toEqual({ ok: false, error: "intervalMs must be positive for interval schedules" });
    expect(restClient.createRecurringTask).not.toHaveBeenCalled();
  });
});
