import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import { API_PREFIX } from "@cove/shared";

describe("agent run usage routes", () => {
  function setup() {
    const db = initDb(":memory:");
    const guild = db.prepare("SELECT id FROM guilds LIMIT 1").get() as { id: string };
    seedChannels(db, guild.id);
    const channel = db.prepare("SELECT id FROM channels WHERE name='general'").get() as { id: string };
    const now = Date.now();
    db.prepare("INSERT INTO users (id,username,bot,token,created_at,updated_at) VALUES ('agent','agent',1,'agent-token',?,?),('viewer','viewer',0,'viewer-token',?,?),('outsider','outsider',0,'outsider-token',?,?)").run(now, now, now, now, now, now);
    db.prepare("INSERT INTO guild_members (guild_id,user_id,roles,joined_at) VALUES (?, 'agent', '[]', ?), (?, 'viewer', '[]', ?)").run(guild.id, now, guild.id, now);
    db.prepare("INSERT INTO messages (id,channel_id,sender,content,timestamp) VALUES ('trigger',?,'agent','go',?)").run(channel.id, now);
    const repos = createRepos(db);
    const run = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, trigger_message_id: "trigger" });
    const app = createApp(db, repos);
    return { db, app, channel, run };
  }

  it("accepts usage writes from the run's own agent", async () => {
    const { db, app, run } = setup();
    const res = await app.request(`${API_PREFIX}/agent-runs/${run.run_id}/usage`, {
      method: "POST",
      headers: { Authorization: "Bot agent-token", "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "p", model: "m", input_tokens: 100, output_tokens: 50, cost: 0.01, cost_source: "price_table" }),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    db.close();
  });

  it("rejects usage writes from another agent (non-member 404)", async () => {
    const { db, app, channel, run } = setup();
    const now = Date.now();
    db.prepare("INSERT INTO users (id,username,bot,token,created_at,updated_at) VALUES ('other','other',1,'other-token',?,?)").run(now, now);
    const res = await app.request(`${API_PREFIX}/agent-runs/${run.run_id}/usage`, {
      method: "POST",
      headers: { Authorization: "Bot other-token", "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "p", model: "m", input_tokens: 100, output_tokens: 50 }),
    });
    // Non-members get 404 (channel existence is not leaked), matching the
    // existing agent-run message-association route behavior.
    expect(res.status).toBe(404);
    db.close();
  });

  it("rejects usage writes without channel permission (non-member 404)", async () => {
    const { db, app, run } = setup();
    const res = await app.request(`${API_PREFIX}/agent-runs/${run.run_id}/usage`, {
      method: "POST",
      headers: { Authorization: "Bot outsider-token", "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "p", model: "m", input_tokens: 100, output_tokens: 50 }),
    });
    expect(res.status).toBe(404);
    db.close();
  });

  it("returns usage in the timeline for authorized viewers", async () => {
    const { db, app, run } = setup();
    await app.request(`${API_PREFIX}/agent-runs/${run.run_id}/usage`, {
      method: "POST",
      headers: { Authorization: "Bot agent-token", "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "p", model: "m", input_tokens: 1000, output_tokens: 500, cost: 0.01, cost_source: "price_table" }),
    });
    const res = await app.request(`${API_PREFIX}/agent-runs/${run.run_id}`, { headers: { Authorization: "Bot viewer-token" } });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      usage: { calls: 1, input_tokens: 1000, output_tokens: 500, cost: 0.01, cost_source: "price_table" },
    });
    db.close();
  });

  it("returns null usage when nothing was recorded", async () => {
    const { db, app, run } = setup();
    const res = await app.request(`${API_PREFIX}/agent-runs/${run.run_id}`, { headers: { Authorization: "Bot viewer-token" } });
    await expect(res.json()).resolves.toMatchObject({ usage: null });
    db.close();
  });
});
