import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import { API_PREFIX } from "@cove/shared";

/**
 * Scope-aggregated usage endpoints:
 *   GET /channels/:channelId/usage               (direct runs only)
 *   GET /channels/:channelId/threads/:threadId/usage  (spans sessions)
 *   GET /tasks/:taskId/usage                     (spans the task's sessions)
 */
describe("agent run usage aggregate routes", () => {
  function setup() {
    const db = initDb(":memory:");
    const guild = db.prepare("SELECT id FROM guilds LIMIT 1").get() as { id: string };
    seedChannels(db, guild.id);
    const channel = db.prepare("SELECT id, guild_id FROM channels WHERE name='general'").get() as { id: string; guild_id: string };
    const now = Date.now();
    db.prepare("INSERT INTO users (id,username,bot,token,created_at,updated_at) VALUES ('agent','agent',1,'agent-token',?,?),('viewer','viewer',0,'viewer-token',?,?),('outsider','outsider',0,'outsider-token',?,?)").run(now, now, now, now, now, now);
    db.prepare("INSERT INTO guild_members (guild_id,user_id,roles,joined_at) VALUES (?, 'agent', '[]', ?), (?, 'viewer', '[]', ?)").run(guild.id, now, guild.id, now);
    db.prepare("INSERT INTO messages (id,channel_id,sender,content,timestamp) VALUES ('trigger',?,'agent','go',?)").run(channel.id, now);
    db.prepare("INSERT INTO messages (id,channel_id,sender,content,timestamp) VALUES ('trigger2',?,'agent','go2',?)").run(channel.id, now);
    const repos = createRepos(db);
    const app = createApp(db, repos);
    return { db, app, channel, guild, repos };
  }

  function recordUsage(app: ReturnType<typeof createApp>, runId: string, model: string, input: number, output: number, cost?: number) {
    return app.request(`${API_PREFIX}/agent-runs/${runId}/usage`, {
      method: "POST",
      headers: { Authorization: "Bot agent-token", "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "floway-sg", model,
        input_tokens: input, output_tokens: output,
        cache_read_tokens: input, cache_write_tokens: output,
        ...(cost === undefined ? {} : { cost, cost_source: "price_table" }),
      }),
    });
  }

  it("aggregates channel usage across chat + all threads (whole channel)", async () => {
    const { db, app, channel, repos } = setup();
    const run = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, trigger_message_id: "trigger" });
    await recordUsage(app, run.run_id, "m1", 1000, 500, 0.01);

    // Thread run in the same channel DOES count — channel-level aggregate means
    // "the whole channel" (chat + threads), matching the header placement.
    const thread = repos.threads.createStandalone(channel.guild_id, channel.id, "thread-1", "agent");
    const threadRun = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, thread_id: thread.id, trigger_message_id: "trigger" });
    await recordUsage(app, threadRun.run_id, "m2", 100, 50, 0.001);

    const res = await app.request(`${API_PREFIX}/channels/${channel.id}/usage`, { headers: { Authorization: "Bot viewer-token" } });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      calls: 2,
      input_tokens: 1100,
      output_tokens: 550,
      cache_read_tokens: 1100,
      cache_write_tokens: 550,
      total_tokens: 3300,
      cost: 0.011,
      currency: "USD",
      cost_source: "price_table",
      models: [
        { model: "m1", calls: 1, input_tokens: 1000, output_tokens: 500, cost: 0.01 },
        { model: "m2", calls: 1, input_tokens: 100, output_tokens: 50, cost: 0.001 },
      ],
    });
    db.close();
  });

  it("aggregates thread usage across multiple runs/sessions", async () => {
    const { db, app, channel, repos } = setup();
    const thread = repos.threads.createStandalone(channel.guild_id, channel.id, "thread-1", "agent");

    // Two separate runs in the same thread (e.g. two sessions).
    const run1 = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, thread_id: thread.id, trigger_message_id: "trigger" });
    await recordUsage(app, run1.run_id, "m1", 1000, 500, 0.01);
    const run2 = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, thread_id: thread.id, trigger_message_id: "trigger2" });
    await recordUsage(app, run2.run_id, "m2", 200, 100, 0.002);

    // A direct channel run must NOT leak into the thread aggregate.
    const direct = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, trigger_message_id: "trigger" });
    await recordUsage(app, direct.run_id, "m3", 999, 999, 0.099);

    const res = await app.request(`${API_PREFIX}/channels/${channel.id}/threads/${thread.id}/usage`, { headers: { Authorization: "Bot viewer-token" } });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      calls: 2,
      input_tokens: 1200,
      output_tokens: 600,
      cache_read_tokens: 1200,
      cache_write_tokens: 600,
      total_tokens: 3600,
      cost: 0.012,
      models: [
        { model: "m1", calls: 1, input_tokens: 1000, output_tokens: 500, cost: 0.01 },
        { model: "m2", calls: 1, input_tokens: 200, output_tokens: 100, cost: 0.002 },
      ],
    });
    db.close();
  });

  it("aggregates task usage across the task's sessions", async () => {
    const { db, app, channel, repos } = setup();
    const thread = repos.threads.createStandalone(channel.guild_id, channel.id, "task-thread", "agent");
    const task = repos.tasks.create("task-1", channel.id, thread.id, "trigger", "agent", "Do the thing", 1, { guild_id: channel.guild_id, created_by: "agent" });

    // NOTE: runs are created WITHOUT task_id — the plugin never sends it. The
    // aggregate must derive the task through the tasks.thread_id link.
    const run1 = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, thread_id: thread.id, trigger_message_id: "trigger" });
    await recordUsage(app, run1.run_id, "m1", 1000, 500, 0.01);
    const run2 = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, thread_id: thread.id, trigger_message_id: "trigger2" });
    await recordUsage(app, run2.run_id, "m1", 500, 250, 0.005);

    // Unrelated run in a different thread (no task) must not count.
    const otherThread = repos.threads.createStandalone(channel.guild_id, channel.id, "other-thread", "agent");
    const other = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, thread_id: otherThread.id, trigger_message_id: "trigger" });
    await recordUsage(app, other.run_id, "m9", 777, 777, 0.077);

    const res = await app.request(`${API_PREFIX}/tasks/${task.task_id}/usage`, { headers: { Authorization: "Bot viewer-token" } });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      calls: 2,
      input_tokens: 1500,
      output_tokens: 750,
      cache_read_tokens: 1500,
      cache_write_tokens: 750,
      total_tokens: 4500,
      cost: 0.015,
      models: [{ model: "m1", calls: 2, input_tokens: 1500, output_tokens: 750, cost: 0.015 }],
    });
    db.close();
  });

  it("returns per-task usage map for the channel task table", async () => {
    const { db, app, channel, repos } = setup();
    const threadA = repos.threads.createStandalone(channel.guild_id, channel.id, "task-thread-a", "agent");
    const threadB = repos.threads.createStandalone(channel.guild_id, channel.id, "task-thread-b", "agent");
    const taskA = repos.tasks.create("task-a", channel.id, threadA.id, "trigger", "agent", "Task A", 1, { guild_id: channel.guild_id, created_by: "agent" });
    const taskB = repos.tasks.create("task-b", channel.id, threadB.id, "trigger2", "agent", "Task B", 2, { guild_id: channel.guild_id, created_by: "agent" });

    // Runs are created WITHOUT task_id (plugin behavior); association must come
    // from the tasks.thread_id link.
    const runA1 = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, thread_id: threadA.id, trigger_message_id: "trigger" });
    await recordUsage(app, runA1.run_id, "m1", 1000, 500, 0.01);
    const runA2 = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, thread_id: threadA.id, trigger_message_id: "trigger" });
    await recordUsage(app, runA2.run_id, "m1", 500, 250, 0.005);
    const runB = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, thread_id: threadB.id, trigger_message_id: "trigger2" });
    await recordUsage(app, runB.run_id, "m2", 100, 50, 0.001);

    // A direct (non-task) run must not appear in the task map.
    const direct = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, trigger_message_id: "trigger" });
    await recordUsage(app, direct.run_id, "m9", 777, 777, 0.077);

    const res = await app.request(`${API_PREFIX}/channels/${channel.id}/tasks/usage`, { headers: { Authorization: "Bot viewer-token" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([taskA.task_id, taskB.task_id].sort());
    expect(body[taskA.task_id]).toMatchObject({ calls: 2, input_tokens: 1500, output_tokens: 750, cost: 0.015 });
    expect(body[taskB.task_id]).toMatchObject({ calls: 1, input_tokens: 100, output_tokens: 50, cost: 0.001 });
    db.close();
  });

  it("gates bulk task usage behind VIEW_CHANNEL (non-member 404)", async () => {
    const { db, app, channel } = setup();
    const res = await app.request(`${API_PREFIX}/channels/${channel.id}/tasks/usage`, { headers: { Authorization: "Bot outsider-token" } });
    expect(res.status).toBe(404);
    db.close();
  });

  it("returns null for scopes with no recorded usage", async () => {
    const { db, app, channel, repos } = setup();
    const thread = repos.threads.createStandalone(channel.guild_id, channel.id, "thread-1", "agent");
    const res = await app.request(`${API_PREFIX}/channels/${channel.id}/threads/${thread.id}/usage`, { headers: { Authorization: "Bot viewer-token" } });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toBeNull();
    db.close();
  });

  it("gates channel usage behind VIEW_CHANNEL (non-member 404)", async () => {
    const { db, app, channel } = setup();
    const res = await app.request(`${API_PREFIX}/channels/${channel.id}/usage`, { headers: { Authorization: "Bot outsider-token" } });
    expect(res.status).toBe(404);
    db.close();
  });

  it("gates thread usage behind VIEW_CHANNEL (non-member 404)", async () => {
    const { db, app, channel, repos } = setup();
    const thread = repos.threads.createStandalone(channel.guild_id, channel.id, "thread-1", "agent");
    const res = await app.request(`${API_PREFIX}/channels/${channel.id}/threads/${thread.id}/usage`, { headers: { Authorization: "Bot outsider-token" } });
    expect(res.status).toBe(404);
    db.close();
  });

  it("gates task usage behind VIEW_CHANNEL (non-member 404) and 404s for unknown tasks", async () => {
    const { db, app, channel, repos } = setup();
    const thread = repos.threads.createStandalone(channel.guild_id, channel.id, "task-thread", "agent");
    const task = repos.tasks.create("task-1", channel.id, thread.id, "trigger", "agent", "Do the thing", 1, { guild_id: channel.guild_id, created_by: "agent" });

    const outsider = await app.request(`${API_PREFIX}/tasks/${task.task_id}/usage`, { headers: { Authorization: "Bot outsider-token" } });
    expect(outsider.status).toBe(404);

    const unknown = await app.request(`${API_PREFIX}/tasks/nope/usage`, { headers: { Authorization: "Bot viewer-token" } });
    expect(unknown.status).toBe(404);
    db.close();
  });
});
