import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";

describe("generic file-backed agent runs", () => {
  it("retains all redacted evidence, serializes same-scope runs, permits concurrent cross-scope runs", () => {
    const db = initDb(); const repos = createRepos(db); const guild = db.prepare("SELECT id FROM guilds LIMIT 1").get() as { id: string };
    seedChannels(db, guild.id); const channel = db.prepare("SELECT id FROM channels LIMIT 1").get() as { id: string };
    db.prepare("INSERT INTO users (id,username,bot,created_at,updated_at) VALUES ('agent','agent',1,1,1)").run();
    db.prepare("INSERT INTO messages (id,channel_id,sender,content,timestamp) VALUES ('m1',?,'agent','go',1),('m2',?,'agent','go too',2)").run(channel.id, channel.id);
    const root = mkdtempSync(join(tmpdir(), "cove-agent-runs-")); (repos.agentRuns as any).root = root;
    const one = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, trigger_message_id: "m1" });
    const two = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, trigger_message_id: "m2" });
    // Same (channel, agent) scope: the second start supersedes the first — the
    // plugin serializes same-scope turns, so a leftover active run is a stale
    // survivor, not a genuine concurrent turn.
    expect(repos.agentRuns.get(one.run_id)?.status).toBe("stale");
    expect(repos.agentRuns.get(two.run_id)?.status).toBe("active");
    const thread = db.prepare("SELECT id FROM channels WHERE id != ? LIMIT 1").get(channel.id) as { id: string };
    const threaded = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, thread_id: thread.id, trigger_message_id: "m1" });
    // Cross-scope concurrency is preserved: the thread run must not disturb the
    // parent channel's active run.
    expect(repos.agentRuns.get(two.run_id)?.status).toBe("active");
    expect(repos.agentRuns.latest({ channelId: channel.id })?.run_id).toBe(two.run_id);
    expect(repos.agentRuns.latest({ channelId: channel.id, threadId: thread.id })?.run_id).toBe(threaded.run_id);
    for (let i = 0; i < 105; i++) repos.agentRuns.append(two.run_id, { type: "tool_progress", action: `step-${i}`, detail: "x".repeat(9_000) });
    repos.agentRuns.append(two.run_id, { type: "tool_started", detail: "Authorization: Bearer secret API_KEY=also-secret" });
    repos.agentRuns.append(two.run_id, { type: "run_finished" });
    const timeline = repos.agentRuns.timelineForRun(two.run_id);
    expect(timeline.events).toHaveLength(107);
    expect(timeline.events.every(event => (event.detail?.length ?? 0) <= 8_040)).toBe(true);
    expect(timeline.events.some(event => event.detail?.includes("also-secret") || event.detail?.includes("Bearer secret"))).toBe(false);
    expect(repos.agentRuns.associateMessage(two.run_id, "m2")?.assistant_message_id).toBe("m2");
    db.close(); rmSync(root, { recursive: true, force: true });
  });

  it("derives task_id from the thread when the caller omits it", () => {
    const db = initDb(); const repos = createRepos(db); const guild = db.prepare("SELECT id FROM guilds LIMIT 1").get() as { id: string };
    seedChannels(db, guild.id); const channel = db.prepare("SELECT id FROM channels LIMIT 1").get() as { id: string };
    db.prepare("INSERT INTO users (id,username,bot,created_at,updated_at) VALUES ('agent','agent',1,1,1)").run();
    // Task thread with an associated task, and a plain thread with no task.
    db.prepare("INSERT INTO channels (id,guild_id,name,type,parent_id) VALUES ('th-task',?,'task-thread',11,?),('th-plain',?,'plain-thread',11,?)").run(guild.id, channel.id, guild.id, channel.id);
    db.prepare("INSERT INTO messages (id,channel_id,sender,content,timestamp) VALUES ('m1','th-task','agent','go',1),('m2','th-plain','agent','go',2)").run();
    db.prepare("INSERT INTO tasks (task_id,channel_id,thread_id,message_id,created_by,title,seq,status,created_at,updated_at) VALUES ('task-1',?,'th-task','m1','agent','T',1,'open',1,1)").run(channel.id);
    const taskRun = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, thread_id: "th-task", trigger_message_id: "m1" });
    const plainRun = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, thread_id: "th-plain", trigger_message_id: "m2" });
    expect(repos.agentRuns.get(taskRun.run_id)?.task_id).toBe("task-1");
    expect(repos.agentRuns.get(plainRun.run_id)?.task_id).toBeNull();
    db.close();
  });
});
