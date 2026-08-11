import { describe, expect, it } from "vitest";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import { createTaskOccurrence } from "../services/task-occurrence.js";

function createTask(repos: ReturnType<typeof createRepos>, channelId: string) {
  repos.db.prepare("INSERT INTO users (id, username, bot, created_at, updated_at) VALUES ('agent', 'agent', 1, 1, 1)").run();
  const creator = repos.users.getById("agent")!;
  const channel = repos.channels.getById(channelId)!;
  return createTaskOccurrence(repos, { channel, creator, title: "Test", assigneeId: "agent" }).task;
}

describe("task run timeline", () => {
  it("bounds and redacts persisted detail, then seals the run", () => {
    const db = initDb();
    const repos = createRepos(db);
    const guild = db.prepare("SELECT id FROM guilds LIMIT 1").get() as { id: string };
    seedChannels(db, guild.id);
    const channel = db.prepare("SELECT id FROM channels LIMIT 1").get() as { id: string };
    const task = createTask(repos, channel.id);
    const run = repos.taskRuns.start(task.task_id, "agent");
    for (let i = 0; i < 105; i++) repos.taskRuns.append(task.task_id, run.run_id, { type: "tool_progress", action: `step-${i}`, detail: "x".repeat(2_100) });
    repos.taskRuns.append(task.task_id, run.run_id, { type: "tool_started", action: "exec", detail: "Authorization: Bearer super-secret-token API_KEY=also-secret" });
    repos.taskRuns.append(task.task_id, run.run_id, { type: "run_finished", action: "Completed" });
    const timeline = repos.taskRuns.timeline(task.task_id);
    expect(timeline.run?.status).toBe("completed");
    expect(timeline.events).toHaveLength(100);
    expect(timeline.events.every((event) => (event.detail?.length ?? 0) <= 2_030)).toBe(true);
    expect(timeline.events.some((event) => event.detail?.includes("super-secret-token") || event.detail?.includes("also-secret"))).toBe(false);
    expect(repos.taskRuns.append(task.task_id, run.run_id, { type: "tool_progress", action: "late" })).toBeNull();
    db.close();
  });

  it("replaces an older active run for the same task", () => {
    const db = initDb(); const repos = createRepos(db);
    const guild = db.prepare("SELECT id FROM guilds LIMIT 1").get() as { id: string }; seedChannels(db, guild.id);
    const channel = db.prepare("SELECT id FROM channels LIMIT 1").get() as { id: string };
    const task = createTask(repos, channel.id);
    const first = repos.taskRuns.start(task.task_id, "agent"); const second = repos.taskRuns.start(task.task_id, "agent");
    expect(repos.taskRuns.get(first.run_id)?.status).toBe("stale");
    expect(repos.taskRuns.timeline(task.task_id).run?.run_id).toBe(second.run_id);
    db.close();
  });
});
