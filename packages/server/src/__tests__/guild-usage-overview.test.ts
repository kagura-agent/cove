import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import { API_PREFIX } from "@cove/shared";

/**
 * Guild-level usage endpoints (#584):
 *   GET /guilds/:guildId/usage/overview  — KPI + per-channel breakdown
 *   GET /guilds/:guildId/usage/daily     — Asia/Shanghai daily series
 *
 * All aggregation reads agent_run_usage.called_at + agent_runs.channel_id /
 * tasks.thread_id — the same source as the per-scope usage endpoints, so
 * totals here must match the sum of per-channel usage.
 */
describe("guild usage overview routes", () => {
  function setup() {
    const db = initDb(":memory:");
    const guild = db.prepare("SELECT id FROM guilds LIMIT 1").get() as { id: string };
    seedChannels(db, guild.id);
    const channel = db.prepare("SELECT id, guild_id FROM channels WHERE name='general'").get() as { id: string; guild_id: string };
    // Second channel for multi-channel breakdown.
    const other = db.prepare("INSERT INTO channels (id, guild_id, name, type, position) VALUES (?, ?, 'dev', 0, 1)").run("ch-dev", guild.id);
    const dev = db.prepare("SELECT id FROM channels WHERE name='dev'").get() as { id: string };
    const now = Date.now();
    db.prepare("INSERT INTO users (id,username,bot,token,created_at,updated_at) VALUES ('agent','agent',1,'agent-token',?,?),('viewer','viewer',0,'viewer-token',?,?),('outsider','outsider',0,'outsider-token',?,?)").run(now, now, now, now, now, now);
    db.prepare("INSERT INTO guild_members (guild_id,user_id,roles,joined_at) VALUES (?, 'agent', '[]', ?), (?, 'viewer', '[]', ?)").run(guild.id, now, guild.id, now);
    db.prepare("INSERT INTO messages (id,channel_id,sender,content,timestamp) VALUES ('trigger',?,'agent','go',?)").run(channel.id, now);
    db.prepare("INSERT INTO messages (id,channel_id,sender,content,timestamp) VALUES ('trigger2',?,'agent','go2',?)").run(channel.id, now);
    const repos = createRepos(db);
    const app = createApp(db, repos);
    return { db, app, channel, dev, guild, repos };
  }

  function recordUsage(app: ReturnType<typeof createApp>, runId: string, model: string, input: number, output: number, cost?: number, calledAt: number = Date.now()) {
    return app.request(`${API_PREFIX}/agent-runs/${runId}/usage`, {
      method: "POST",
      headers: { Authorization: "Bot agent-token", "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "floway-sg", model,
        input_tokens: input, output_tokens: output,
        cache_read_tokens: input, cache_write_tokens: output,
        ...(cost === undefined ? {} : { cost, cost_source: "price_table" }),
        called_at: calledAt,
      }),
    });
  }

  it("returns KPI + per-channel breakdown with task counts", async () => {
    const { db, app, channel, dev, repos } = setup();
    // Channel run (no task) + task run in a thread, same channel.
    const direct = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, trigger_message_id: "trigger" });
    await recordUsage(app, direct.run_id, "m1", 1000, 500, 0.01);
    const thread = repos.threads.createStandalone(channel.guild_id, channel.id, "task-thread", "agent");
    const task = repos.tasks.create("task-1", channel.id, thread.id, "trigger", "agent", "Do the thing", 1, { guild_id: channel.guild_id, created_by: "agent" });
    const taskRun = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, thread_id: thread.id, trigger_message_id: "trigger2" });
    await recordUsage(app, taskRun.run_id, "m2", 100, 50, 0.005);

    // Second channel: one task with two calls.
    const devThread = repos.threads.createStandalone(channel.guild_id, dev.id, "dev-thread", "agent");
    const devTask = repos.tasks.create("task-2", dev.id, devThread.id, "trigger", "agent", "Dev thing", 2, { guild_id: channel.guild_id, created_by: "agent" });
    const devRun1 = repos.agentRuns.start({ agent_id: "agent", channel_id: dev.id, thread_id: devThread.id, trigger_message_id: "trigger" });
    await recordUsage(app, devRun1.run_id, "m3", 200, 100, 0.002);
    const devRun2 = repos.agentRuns.start({ agent_id: "agent", channel_id: dev.id, thread_id: devThread.id, trigger_message_id: "trigger2" });
    await recordUsage(app, devRun2.run_id, "m3", 300, 150, 0.003);

    const res = await app.request(`${API_PREFIX}/guilds/${channel.guild_id}/usage/overview`, { headers: { Authorization: "Bot viewer-token" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.guild_id).toBe(channel.guild_id);
    // total cost = 0.01 + 0.005 + 0.002 + 0.003
    expect(body.total_cost).toBeCloseTo(0.02);
    expect(body.today_cost).toBeCloseTo(0.02);
    expect(body.today_calls).toBe(4);
    expect(body.today_tasks).toBe(2);
    // 2 channels with usage, 2 distinct tasks.
    expect(body.active_channels).toBe(2);
    expect(body.active_tasks).toBe(2);
    expect(body.channels).toHaveLength(2);

    const general = body.channels.find((c: { channel_id: string }) => c.channel_id === channel.id);
    const devRow = body.channels.find((c: { channel_id: string }) => c.channel_id === dev.id);
    expect(general).toMatchObject({ calls: 2, tasks: 1, cost: 0.015 });
    expect(devRow).toMatchObject({ calls: 2, tasks: 1, cost: 0.005 });
    // Models breakdown per channel.
    expect(general.models.map((m: { model: string }) => m.model).sort()).toEqual(["m1", "m2"]);
    expect(devRow.models).toHaveLength(1);
    expect(devRow.models[0]).toMatchObject({ model: "m3", calls: 2, cost: 0.005 });
    // Task ranking: highest cost first, carries title/channel/status.
    expect(body.tasks).toHaveLength(2);
    // Both tasks cost 0.005 → tie broken by title: "Dev thing" < "Do the thing".
    expect(body.tasks[0]).toMatchObject({ task_id: devTask.task_id, thread_id: devThread.id, calls: 2, cost: 0.005, channel_id: dev.id, title: "Dev thing" });
    expect(body.tasks[1]).toMatchObject({ task_id: task.task_id, thread_id: thread.id, calls: 1, cost: 0.005, channel_id: channel.id, title: "Do the thing" });
    expect(body.tasks.map((t: { task_id: string }) => t.task_id)).toEqual([devTask.task_id, task.task_id]);
    expect(body.tasks.every((t: { status: string }) => ["open", "in_progress", "in_review", "done", "cancelled"].includes(t.status))).toBe(true);
    db.close();
  });

  it("returns daily series bucketed by Asia/Shanghai day with zero-fill", async () => {
    const { db, app, channel, repos } = setup();
    // Build timestamps: two days ago, yesterday, and today (local time).
    const dayMs = 24 * 60 * 60 * 1000;
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const t0 = startOfToday.getTime();
    const run1 = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, trigger_message_id: "trigger" });
    await recordUsage(app, run1.run_id, "m1", 1000, 500, 0.01, t0 - 2 * dayMs);
    // Yesterday's run belongs to a task (thread link) — exercises daily task counts.
    const thread = repos.threads.createStandalone(channel.guild_id, channel.id, "task-thread", "agent");
    repos.tasks.create("task-daily", channel.id, thread.id, "trigger", "agent", "Daily task", 1, { guild_id: channel.guild_id, created_by: "agent" });
    const run2 = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, thread_id: thread.id, trigger_message_id: "trigger2" });
    await recordUsage(app, run2.run_id, "m2", 100, 50, 0.005, t0 - dayMs);
    const run3 = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, trigger_message_id: "trigger" });
    await recordUsage(app, run3.run_id, "m3", 200, 100, 0.002, t0 + 1);

    const res = await app.request(`${API_PREFIX}/guilds/${channel.guild_id}/usage/daily?days=14`, { headers: { Authorization: "Bot viewer-token" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(14);
    // Zero-filled days have cost null.
    expect(body.filter((d: { cost: number | null }) => d.cost !== null)).toHaveLength(3);
    // Task counts: only yesterday's run belongs to a task (1 day with tasks).
    expect(body.filter((d: { tasks: number }) => d.tasks > 0)).toHaveLength(1);
    expect(body[body.length - 2].tasks).toBe(1);
    // Today's slice.
    const today = body[body.length - 1];
    expect(today.cost).toBeCloseTo(0.002);
    expect(today.calls).toBe(1);
    expect(today.total_tokens).toBe(600); // input 200 + output 100 + cache read 200 + cache write 100
    expect(today.models).toHaveLength(1);
    expect(today.models[0]).toMatchObject({ model: "m3", calls: 1, cost: 0.002 });
    // Dates are YYYY-MM-DD and consecutive.
    expect(today.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    db.close();
  });

  it("gates guild overview behind guild membership (non-member 404)", async () => {
    const { db, app, channel } = setup();
    const res = await app.request(`${API_PREFIX}/guilds/${channel.guild_id}/usage/overview`, { headers: { Authorization: "Bot outsider-token" } });
    expect(res.status).toBe(404);
    db.close();
  });

  it("gates guild daily behind guild membership (non-member 404)", async () => {
    const { db, app, channel } = setup();
    const res = await app.request(`${API_PREFIX}/guilds/${channel.guild_id}/usage/daily`, { headers: { Authorization: "Bot outsider-token" } });
    expect(res.status).toBe(404);
    db.close();
  });

  it("returns empty overview for guild with no usage", async () => {
    const { db, app, channel } = setup();
    const res = await app.request(`${API_PREFIX}/guilds/${channel.guild_id}/usage/overview`, { headers: { Authorization: "Bot viewer-token" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_cost).toBeNull();
    expect(body.active_channels).toBe(0);
    expect(body.channels).toEqual([]);
    db.close();
  });

  it("returns zero-filled daily for guild with no usage", async () => {
    const { db, app, channel } = setup();
    const res = await app.request(`${API_PREFIX}/guilds/${channel.guild_id}/usage/daily?days=7`, { headers: { Authorization: "Bot viewer-token" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(7);
    expect(body.every((d: { cost: number | null }) => d.cost === null)).toBe(true);
    db.close();
  });

  it("does not leak other guild usage (channel id scoping)", async () => {
    const { db, app, channel, repos } = setup();
    const direct = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, trigger_message_id: "trigger" });
    await recordUsage(app, direct.run_id, "m1", 1000, 500, 0.01);
    const res = await app.request(`${API_PREFIX}/guilds/${channel.guild_id}/usage/overview`, { headers: { Authorization: "Bot viewer-token" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_cost).toBeCloseTo(0.01);
    expect(body.active_channels).toBe(1);
    expect(body.channels[0].channel_id).toBe(channel.id);
    db.close();
  });

  it("filters overview by range (only rows within the window)", async () => {
    const { db, app, channel, repos } = setup();
    const dayMs = 24 * 60 * 60 * 1000;
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const t0 = startOfToday.getTime();
    // 40 days ago: outside 14d but inside 90d/all.
    const old = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, trigger_message_id: "trigger" });
    await recordUsage(app, old.run_id, "m1", 1000, 500, 0.5, t0 - 40 * dayMs);
    // Today: inside every range.
    const nowRun = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, trigger_message_id: "trigger2" });
    await recordUsage(app, nowRun.run_id, "m2", 100, 50, 0.01, t0 + 1);

    // Default (14d): only today's row.
    const r14 = await app.request(`${API_PREFIX}/guilds/${channel.guild_id}/usage/overview`, { headers: { Authorization: "Bot viewer-token" } });
    const b14 = await r14.json();
    expect(b14.range).toBe(14);
    expect(b14.total_cost).toBeCloseTo(0.01);
    expect(b14.active_tasks).toBe(0);

    // range=90: both rows.
    const r90 = await app.request(`${API_PREFIX}/guilds/${channel.guild_id}/usage/overview?range=90`, { headers: { Authorization: "Bot viewer-token" } });
    const b90 = await r90.json();
    expect(b90.range).toBe(90);
    expect(b90.total_cost).toBeCloseTo(0.51);
    expect(b90.active_tasks).toBe(0);

    // range=all: both rows.
    const rall = await app.request(`${API_PREFIX}/guilds/${channel.guild_id}/usage/overview?range=all`, { headers: { Authorization: "Bot viewer-token" } });
    const ball = await rall.json();
    expect(ball.range).toBe("all");
    expect(ball.total_cost).toBeCloseTo(0.51);

    // daily honors range=30 (30 buckets, only today's bucket has cost).
    const d30 = await app.request(`${API_PREFIX}/guilds/${channel.guild_id}/usage/daily?range=30`, { headers: { Authorization: "Bot viewer-token" } });
    const dd30 = await d30.json();
    expect(dd30).toHaveLength(30);
    expect(dd30[29].cost).toBeCloseTo(0.01);
    db.close();
  });
});
