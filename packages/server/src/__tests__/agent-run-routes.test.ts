import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import { API_PREFIX } from "@cove/shared";
/** The message association endpoint must not become a global run-log oracle. */
describe("agent run message association route", () => {
  it("returns only the run associated with a message in a channel the viewer can see", async () => {
    const db = initDb(":memory:");
    const guild = db.prepare("SELECT id FROM guilds LIMIT 1").get() as { id: string };
    seedChannels(db, guild.id);
    const channel = db.prepare("SELECT id FROM channels WHERE name='general'").get() as { id: string };
    const other = db.prepare("SELECT id FROM channels WHERE id != ? LIMIT 1").get(channel.id) as { id: string };
    const now = Date.now();
    db.prepare("INSERT INTO users (id,username,bot,token,created_at,updated_at) VALUES ('agent','agent',1,'agent-token',?,?),('viewer','viewer',0,'viewer-token',?,?),('outsider','outsider',0,'outsider-token',?,?)").run(now, now, now, now, now, now);
    db.prepare("INSERT INTO guild_members (guild_id,user_id,roles,joined_at) VALUES (?, 'agent', '[]', ?), (?, 'viewer', '[]', ?)").run(guild.id, now, guild.id, now);
    db.prepare("INSERT INTO messages (id,channel_id,sender,content,timestamp) VALUES ('trigger',?,'agent','go',?),('answer',?,'agent','done',?)").run(channel.id, now, channel.id, now + 1);
    const repos = createRepos(db);
    const run = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, trigger_message_id: "trigger" });
    repos.agentRuns.append(run.run_id, { type: "tool_started", action: "Read", detail: "file" });
    repos.agentRuns.associateMessage(run.run_id, "answer");
    const app = createApp(db, repos);
    const request = (token: string, channelId = channel.id, messageId = "answer") => app.request(`${API_PREFIX}/channels/${channelId}/messages/${messageId}/agent-run`, { headers: { Authorization: `Bot ${token}` } });

    const allowed = await request("viewer-token");
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toMatchObject({ run: { run_id: run.run_id }, events: [{ action: "Read" }] });
    // Same id cannot be resolved through a different channel scope.
    await expect((await request("viewer-token", other.id)).json()).resolves.toMatchObject({ code: 10008 });
    expect((await request("viewer-token", other.id)).status).toBe(404);
    // A non-member cannot learn whether the associated run exists.
    expect((await request("outsider-token")).status).toBe(404);
    db.close();
  });
});
