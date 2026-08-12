import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";

describe("generic file-backed agent runs", () => {
  it("retains all redacted evidence and permits concurrent normal-channel runs", () => {
    const db = initDb(); const repos = createRepos(db); const guild = db.prepare("SELECT id FROM guilds LIMIT 1").get() as { id: string };
    seedChannels(db, guild.id); const channel = db.prepare("SELECT id FROM channels LIMIT 1").get() as { id: string };
    db.prepare("INSERT INTO users (id,username,bot,created_at,updated_at) VALUES ('agent','agent',1,1,1)").run();
    db.prepare("INSERT INTO messages (id,channel_id,sender,content,timestamp) VALUES ('m1',?,'agent','go',1),('m2',?,'agent','go too',2)").run(channel.id, channel.id);
    const root = mkdtempSync(join(tmpdir(), "cove-agent-runs-")); (repos.agentRuns as any).root = root;
    const one = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, trigger_message_id: "m1" });
    const two = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, trigger_message_id: "m2" });
    expect(repos.agentRuns.get(one.run_id)?.status).toBe("active");
    for (let i = 0; i < 105; i++) repos.agentRuns.append(one.run_id, { type: "tool_progress", action: `step-${i}`, detail: "x".repeat(9_000) });
    repos.agentRuns.append(one.run_id, { type: "tool_started", detail: "Authorization: Bearer secret API_KEY=also-secret" });
    repos.agentRuns.append(one.run_id, { type: "run_finished" });
    const timeline = repos.agentRuns.timelineForRun(one.run_id);
    expect(timeline.events).toHaveLength(107);
    expect(timeline.events.every(event => (event.detail?.length ?? 0) <= 8_040)).toBe(true);
    expect(timeline.events.some(event => event.detail?.includes("also-secret") || event.detail?.includes("Bearer secret"))).toBe(false);
    expect(repos.agentRuns.associateMessage(one.run_id, "m2")?.assistant_message_id).toBe("m2");
    db.close(); rmSync(root, { recursive: true, force: true });
  });
});
