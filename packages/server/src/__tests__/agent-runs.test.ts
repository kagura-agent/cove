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
    // A zombie thread run (dispatch died before reporting a terminal event) must
    // be expired by a thread-scoped lookup — the parent-channel scope must not
    // touch it, and neither may it stay 'active' forever.
    repos.agentRuns.append(threaded.run_id, { type: "tool_progress", action: "work", detail: "in progress" });
    const expiredAt = Date.now() - 31 * 60 * 1000;
    db.prepare("UPDATE agent_runs SET expires_at=? WHERE run_id=?").run(expiredAt, threaded.run_id);
    expect(repos.agentRuns.latest({ channelId: channel.id })?.run_id).toBe(two.run_id); // parent lookup untouched
    expect(repos.agentRuns.get(threaded.run_id)?.status).toBe("active"); // still active before thread lookup
    const threadLookup = repos.agentRuns.latest({ channelId: channel.id, threadId: thread.id });
    expect(threadLookup?.run_id).toBe(threaded.run_id); // still the latest run…
    expect(threadLookup?.status).toBe("stale"); // …but the lookup expired the zombie (card hides on non-active)
    expect(repos.agentRuns.get(threaded.run_id)?.status).toBe("stale");
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

  it("expire materializes stats only for runs in the same scope as the UPDATE", () => {
    const db = initDb(); const repos = createRepos(db);
    const guild = db.prepare("SELECT id FROM guilds LIMIT 1").get() as { id: string };
    seedChannels(db, guild.id);
    const [chA, chB] = db.prepare("SELECT id FROM channels ORDER BY position LIMIT 2").all() as Array<{ id: string }>;
    db.prepare("INSERT INTO users (id,username,bot,created_at,updated_at) VALUES ('agent','agent',1,1,1)").run();
    db.prepare("INSERT INTO messages (id,channel_id,sender,content,timestamp) VALUES ('m1',?,'agent','go',1),('m2',?,'agent','go',2),('m3',?,'agent','go',3)").run(chA.id, chB.id, chA.id);
    const root = mkdtempSync(join(tmpdir(), "cove-expire-scope-")); (repos.agentRuns as any).root = root;
    const statsRow = (runId: string) => db.prepare("SELECT run_id FROM agent_run_stats WHERE run_id=?").get(runId);
    const past = Date.now() - 31 * 60 * 1000;

    // chA: an active run past its expiry window (the expire target).
    const inScope = repos.agentRuns.start({ agent_id: "agent", channel_id: chA.id, trigger_message_id: "m1" });
    // chB: a stale, expired run from another channel. The pre-fix SELECT swept
    // every stale run regardless of scope, so this would be materialized too.
    const outOfScope = repos.agentRuns.start({ agent_id: "agent", channel_id: chB.id, trigger_message_id: "m2" });
    // chA thread: another stale candidate the parent-channel scope must not touch.
    const threadRun = repos.agentRuns.start({ agent_id: "agent", channel_id: chA.id, thread_id: chB.id, trigger_message_id: "m3" });
    // All runs created first (start() expires its own channel internally), then
    // expire them together so the scope filter is the only thing under test.
    db.prepare("UPDATE agent_runs SET expires_at=? WHERE run_id=?").run(past, inScope.run_id);
    db.prepare("UPDATE agent_runs SET status='stale', expires_at=? WHERE run_id=?").run(past, outOfScope.run_id);
    db.prepare("UPDATE agent_runs SET expires_at=? WHERE run_id=?").run(past, threadRun.run_id);

    repos.agentRuns.expire({ channelId: chA.id });

    expect(repos.agentRuns.get(inScope.run_id)?.status).toBe("stale");
    expect(statsRow(inScope.run_id)).toBeDefined();       // in-scope run materialized
    expect(statsRow(outOfScope.run_id)).toBeUndefined();  // other channel untouched
    expect(statsRow(threadRun.run_id)).toBeUndefined();   // thread run untouched by parent scope
    db.close(); rmSync(root, { recursive: true, force: true });
  });

  it("thread-scoped expire materializes the thread run only", () => {
    const db = initDb(); const repos = createRepos(db);
    const guild = db.prepare("SELECT id FROM guilds LIMIT 1").get() as { id: string };
    seedChannels(db, guild.id);
    const [chA, chB] = db.prepare("SELECT id FROM channels ORDER BY position LIMIT 2").all() as Array<{ id: string }>;
    db.prepare("INSERT INTO users (id,username,bot,created_at,updated_at) VALUES ('agent','agent',1,1,1)").run();
    db.prepare("INSERT INTO messages (id,channel_id,sender,content,timestamp) VALUES ('m1',?,'agent','go',1),('m2',?,'agent','go',2)").run(chA.id, chA.id);
    const root = mkdtempSync(join(tmpdir(), "cove-expire-thread-")); (repos.agentRuns as any).root = root;
    const statsRow = (runId: string) => db.prepare("SELECT run_id FROM agent_run_stats WHERE run_id=?").get(runId);
    const past = Date.now() - 31 * 60 * 1000;

    const parent = repos.agentRuns.start({ agent_id: "agent", channel_id: chA.id, trigger_message_id: "m1" });
    const threaded = repos.agentRuns.start({ agent_id: "agent", channel_id: chA.id, thread_id: chB.id, trigger_message_id: "m2" });
    // Both created first (start() expires the parent channel internally), then
    // expired together so the thread scope is the only thing under test.
    db.prepare("UPDATE agent_runs SET expires_at=? WHERE run_id=?").run(past, parent.run_id);
    db.prepare("UPDATE agent_runs SET expires_at=? WHERE run_id=?").run(past, threaded.run_id);

    repos.agentRuns.expire({ channelId: chA.id, threadId: chB.id });

    expect(repos.agentRuns.get(threaded.run_id)?.status).toBe("stale");
    expect(statsRow(threaded.run_id)).toBeDefined();   // thread run materialized
    expect(repos.agentRuns.get(parent.run_id)?.status).toBe("active"); // parent untouched
    expect(statsRow(parent.run_id)).toBeUndefined();   // parent-channel run untouched
    db.close(); rmSync(root, { recursive: true, force: true });
  });
});
