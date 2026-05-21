import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedScenes } from "../db/schema.js";
import type Database from "better-sqlite3";
import type { DiscordChannel, DiscordMessage, SceneState, CoveAgent, CoveGuildMember } from "@cove/shared";

describe("Cove API — Discord-compatible", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  const broadcastEvents: unknown[] = [];

  beforeEach(() => {
    db = initDb(":memory:");
    seedScenes(db);
    broadcastEvents.length = 0;
    app = createApp(db, (event) => broadcastEvents.push(event));
  });

  // ─── Channels ───────────────────────────────────────────────────────────

  describe("GET /api/v10/guilds/cove/channels", () => {
    it("returns all seeded channels in Discord format", async () => {
      const res = await app.request("/api/v10/guilds/cove/channels");
      expect(res.status).toBe(200);
      const channels: DiscordChannel[] = await res.json();
      expect(channels).toHaveLength(4);
    });

    it("each channel has Discord-required fields", async () => {
      const res = await app.request("/api/v10/guilds/cove/channels");
      const channels: DiscordChannel[] = await res.json();
      for (const ch of channels) {
        expect(ch.id).toBeTruthy();
        expect(ch.name).toBeTruthy();
        expect(ch.type).toBe(0);
        expect(ch.guild_id).toBe("cove");
        expect(typeof ch.topic).toBe("string");
        expect(typeof ch.position).toBe("number");
      }
    });

    it("includes Cove extension fields", async () => {
      const res = await app.request("/api/v10/guilds/cove/channels");
      const channels: DiscordChannel[] = await res.json();
      const garden = channels.find((c) => c.id === "garden");
      expect(garden).toBeDefined();
      expect(garden!.icon).toBe("🌱");
      expect(garden!.scene_type).toBe("open");
      expect(garden!.cove_position).toEqual({ x: 200, y: 200 });
    });

    it("returns 404 for unknown guild", async () => {
      const res = await app.request("/api/v10/guilds/unknown/channels");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/v10/channels/:id", () => {
    it("returns a specific channel in Discord format", async () => {
      const res = await app.request("/api/v10/channels/garden");
      expect(res.status).toBe(200);
      const ch: DiscordChannel = await res.json();
      expect(ch.id).toBe("garden");
      expect(ch.name).toBe("Garden");
      expect(ch.type).toBe(0);
      expect(ch.guild_id).toBe("cove");
      expect(ch.topic).toBe("Tend your plants and watch them grow");
    });

    it("returns 404 for unknown channel", async () => {
      const res = await app.request("/api/v10/channels/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  // ─── Messages ───────────────────────────────────────────────────────────

  describe("GET /api/v10/channels/:id/messages", () => {
    it("returns empty array for channel with no messages", async () => {
      const res = await app.request("/api/v10/channels/garden/messages");
      expect(res.status).toBe(200);
      const messages: DiscordMessage[] = await res.json();
      expect(messages).toEqual([]);
    });

    it("returns 404 for unknown channel", async () => {
      const res = await app.request("/api/v10/channels/nonexistent/messages");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/v10/channels/:id/messages", () => {
    it("creates a message and returns Discord format", async () => {
      const res = await app.request("/api/v10/channels/garden/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bot kagura",
        },
        body: JSON.stringify({ content: "The roses look beautiful today!" }),
      });
      expect(res.status).toBe(201);
      const msg: DiscordMessage = await res.json();
      expect(msg.channel_id).toBe("garden");
      expect(msg.content).toBe("The roses look beautiful today!");
      expect(msg.author.id).toBe("kagura");
      expect(msg.author.username).toBe("kagura");
      expect(msg.author.bot).toBe(true);
      expect(msg.type).toBe(0);
      expect(msg.id).toBeTruthy();
      expect(msg.timestamp).toBeTruthy();
      // Verify ISO 8601
      expect(new Date(msg.timestamp).toISOString()).toBe(msg.timestamp);
    });

    it("uses anonymous author when no auth header", async () => {
      const res = await app.request("/api/v10/channels/garden/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Hello" }),
      });
      expect(res.status).toBe(201);
      const msg: DiscordMessage = await res.json();
      expect(msg.author.id).toBe("anonymous");
      expect(msg.author.username).toBe("anonymous");
    });

    it("message appears in channel messages list", async () => {
      await app.request("/api/v10/channels/garden/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bot kagura",
        },
        body: JSON.stringify({ content: "Watering the plants" }),
      });

      const res = await app.request("/api/v10/channels/garden/messages");
      const messages: DiscordMessage[] = await res.json();
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Watering the plants");
      expect(messages[0].channel_id).toBe("garden");
    });

    it("broadcasts MESSAGE_CREATE event", async () => {
      await app.request("/api/v10/channels/garden/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bot kagura",
        },
        body: JSON.stringify({ content: "test broadcast" }),
      });

      expect(broadcastEvents).toHaveLength(1);
      const event = broadcastEvents[0] as { op: number; t: string; d: DiscordMessage };
      expect(event.op).toBe(0);
      expect(event.t).toBe("MESSAGE_CREATE");
      expect(event.d.content).toBe("test broadcast");
    });

    it("returns 404 for unknown channel", async () => {
      const res = await app.request("/api/v10/channels/nonexistent/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── Single message ─────────────────────────────────────────────────────

  describe("GET /api/v10/channels/:id/messages/:msgId", () => {
    it("returns a single message by ID", async () => {
      const createRes = await app.request("/api/v10/channels/garden/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bot kagura" },
        body: JSON.stringify({ content: "find me" }),
      });
      const created: DiscordMessage = await createRes.json();

      const res = await app.request(`/api/v10/channels/garden/messages/${created.id}`);
      expect(res.status).toBe(200);
      const msg: DiscordMessage = await res.json();
      expect(msg.id).toBe(created.id);
      expect(msg.content).toBe("find me");
      expect(msg.channel_id).toBe("garden");
    });

    it("returns 404 for nonexistent message", async () => {
      const res = await app.request("/api/v10/channels/garden/messages/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  // ─── Delete single message ──────────────────────────────────────────────

  describe("DELETE /api/v10/channels/:id/messages/:msgId", () => {
    it("deletes a message and returns 204", async () => {
      const createRes = await app.request("/api/v10/channels/garden/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bot kagura" },
        body: JSON.stringify({ content: "delete me" }),
      });
      const created: DiscordMessage = await createRes.json();
      broadcastEvents.length = 0;

      const delRes = await app.request(`/api/v10/channels/garden/messages/${created.id}`, {
        method: "DELETE",
      });
      expect(delRes.status).toBe(204);

      // Verify MESSAGE_DELETE broadcast
      expect(broadcastEvents).toHaveLength(1);
      const event = broadcastEvents[0] as { op: number; t: string; d: { id: string; channel_id: string } };
      expect(event.op).toBe(0);
      expect(event.t).toBe("MESSAGE_DELETE");
      expect(event.d.id).toBe(created.id);
      expect(event.d.channel_id).toBe("garden");

      // Verify message is gone
      const getRes = await app.request(`/api/v10/channels/garden/messages/${created.id}`);
      expect(getRes.status).toBe(404);
    });

    it("returns 404 for nonexistent message", async () => {
      const res = await app.request("/api/v10/channels/garden/messages/nonexistent", {
        method: "DELETE",
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── Edit message ───────────────────────────────────────────────────────

  describe("PATCH /api/v10/channels/:id/messages/:msgId", () => {
    it("edits a message and returns updated content with edited_timestamp", async () => {
      const createRes = await app.request("/api/v10/channels/garden/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bot kagura" },
        body: JSON.stringify({ content: "original" }),
      });
      const created: DiscordMessage = await createRes.json();
      expect(created.edited_timestamp).toBeNull();
      broadcastEvents.length = 0;

      const patchRes = await app.request(`/api/v10/channels/garden/messages/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "edited" }),
      });
      expect(patchRes.status).toBe(200);
      const updated: DiscordMessage = await patchRes.json();
      expect(updated.content).toBe("edited");
      expect(updated.edited_timestamp).toBeTruthy();
      expect(new Date(updated.edited_timestamp!).toISOString()).toBe(updated.edited_timestamp);

      // Verify MESSAGE_UPDATE broadcast
      expect(broadcastEvents).toHaveLength(1);
      const event = broadcastEvents[0] as { op: number; t: string; d: DiscordMessage };
      expect(event.op).toBe(0);
      expect(event.t).toBe("MESSAGE_UPDATE");
      expect(event.d.content).toBe("edited");
    });

    it("returns 404 for nonexistent message", async () => {
      const res = await app.request("/api/v10/channels/garden/messages/nonexistent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "nope" }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── Typing indicator ──────────────────────────────────────────────────

  describe("POST /api/v10/channels/:id/typing", () => {
    it("returns 204 and broadcasts TYPING_START", async () => {
      broadcastEvents.length = 0;
      const res = await app.request("/api/v10/channels/garden/typing", {
        method: "POST",
        headers: { Authorization: "Bot kagura" },
      });
      expect(res.status).toBe(204);

      expect(broadcastEvents).toHaveLength(1);
      const event = broadcastEvents[0] as { op: number; t: string; d: { channel_id: string; user_id: string; timestamp: number } };
      expect(event.op).toBe(0);
      expect(event.t).toBe("TYPING_START");
      expect(event.d.channel_id).toBe("garden");
      expect(event.d.user_id).toBe("kagura");
      expect(typeof event.d.timestamp).toBe("number");
    });
  });

  // ─── Pagination ────────────────────────────────────────────────────────

  describe("GET /api/v10/channels/:id/messages — pagination", () => {
    let messageIds: string[];

    beforeEach(() => {
      // Insert 5 messages with incrementing timestamps
      messageIds = [];
      const insert = db.prepare(
        "INSERT INTO messages (id, scene_id, sender, content, timestamp, metadata, edited_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      for (let i = 0; i < 5; i++) {
        const id = `msg-${i}`;
        insert.run(id, "garden", "kagura", `message ${i}`, 1000000 + i * 1000, null, null);
        messageIds.push(id);
      }
    });

    it("before returns messages older than reference", async () => {
      // msg-3 timestamp = 1003000, so before should return msg-0, msg-1, msg-2
      const res = await app.request("/api/v10/channels/garden/messages?before=msg-3");
      expect(res.status).toBe(200);
      const msgs: DiscordMessage[] = await res.json();
      expect(msgs).toHaveLength(3);
      // DESC order
      expect(msgs[0].id).toBe("msg-2");
      expect(msgs[1].id).toBe("msg-1");
      expect(msgs[2].id).toBe("msg-0");
    });

    it("after returns messages newer than reference", async () => {
      // msg-1 timestamp = 1001000, so after should return msg-2, msg-3, msg-4
      const res = await app.request("/api/v10/channels/garden/messages?after=msg-1");
      expect(res.status).toBe(200);
      const msgs: DiscordMessage[] = await res.json();
      expect(msgs).toHaveLength(3);
      // ASC order for after
      expect(msgs[0].id).toBe("msg-2");
      expect(msgs[1].id).toBe("msg-3");
      expect(msgs[2].id).toBe("msg-4");
    });

    it("around returns messages around reference", async () => {
      const res = await app.request("/api/v10/channels/garden/messages?around=msg-2&limit=4");
      expect(res.status).toBe(200);
      const msgs: DiscordMessage[] = await res.json();
      // Should include msg-2 center + 2 before/after (limited by half=2)
      expect(msgs.length).toBeGreaterThanOrEqual(3);
      const ids = msgs.map((m) => m.id);
      expect(ids).toContain("msg-2");
    });

    it("returns empty array for unknown reference message", async () => {
      const res = await app.request("/api/v10/channels/garden/messages?before=nonexistent");
      expect(res.status).toBe(200);
      const msgs: DiscordMessage[] = await res.json();
      expect(msgs).toEqual([]);
    });
  });

  // ─── Scene state (Cove extension) ─────────────────────────────────────

  describe("Channel state", () => {
    it("PUT creates state entry, GET retrieves it", async () => {
      const putRes = await app.request("/api/v10/channels/garden/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "flowers_watered", value: "3" }),
      });
      expect(putRes.status).toBe(200);
      const entry: SceneState = await putRes.json();
      expect(entry.sceneId).toBe("garden");
      expect(entry.key).toBe("flowers_watered");
      expect(entry.value).toBe("3");

      const getRes = await app.request("/api/v10/channels/garden/state");
      const state: SceneState[] = await getRes.json();
      expect(state).toHaveLength(1);
      expect(state[0].key).toBe("flowers_watered");
      expect(state[0].value).toBe("3");
    });

    it("PUT updates existing state entry", async () => {
      await app.request("/api/v10/channels/garden/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "flowers_watered", value: "3" }),
      });
      await app.request("/api/v10/channels/garden/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "flowers_watered", value: "5" }),
      });

      const getRes = await app.request("/api/v10/channels/garden/state");
      const state: SceneState[] = await getRes.json();
      expect(state).toHaveLength(1);
      expect(state[0].value).toBe("5");
    });

    it("PUT broadcasts STATE_UPDATE event", async () => {
      broadcastEvents.length = 0;
      await app.request("/api/v10/channels/garden/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "mood", value: "happy" }),
      });

      expect(broadcastEvents).toHaveLength(1);
      const event = broadcastEvents[0] as { op: number; t: string; d: SceneState };
      expect(event.op).toBe(0);
      expect(event.t).toBe("STATE_UPDATE");
      expect(event.d.sceneId).toBe("garden");
      expect(event.d.key).toBe("mood");
      expect(event.d.value).toBe("happy");
    });
  });

  // ─── Channel PATCH ──────────────────────────────────────────────────

  describe("PATCH /api/v10/channels/:id", () => {
    it("updates channel name and topic", async () => {
      const res = await app.request("/api/v10/channels/garden", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Zen Garden", topic: "A peaceful place" }),
      });
      expect(res.status).toBe(200);
      const ch: DiscordChannel = await res.json();
      expect(ch.name).toBe("Zen Garden");
      expect(ch.topic).toBe("A peaceful place");
      expect(ch.id).toBe("garden");
    });

    it("updates icon only", async () => {
      const res = await app.request("/api/v10/channels/garden", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icon: "🌺" }),
      });
      expect(res.status).toBe(200);
      const ch: DiscordChannel = await res.json();
      expect(ch.icon).toBe("🌺");
      expect(ch.name).toBe("Garden"); // unchanged
    });

    it("updates cove_position", async () => {
      const res = await app.request("/api/v10/channels/garden", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cove_position: { x: 999, y: 888 } }),
      });
      expect(res.status).toBe(200);
      const ch: DiscordChannel = await res.json();
      expect(ch.cove_position).toEqual({ x: 999, y: 888 });
    });

    it("broadcasts CHANNEL_UPDATE event", async () => {
      broadcastEvents.length = 0;
      await app.request("/api/v10/channels/garden", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: "updated" }),
      });

      expect(broadcastEvents).toHaveLength(1);
      const event = broadcastEvents[0] as { op: number; t: string; d: DiscordChannel };
      expect(event.op).toBe(0);
      expect(event.t).toBe("CHANNEL_UPDATE");
      expect(event.d.topic).toBe("updated");
    });

    it("returns current state for empty body", async () => {
      const res = await app.request("/api/v10/channels/garden", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const ch: DiscordChannel = await res.json();
      expect(ch.id).toBe("garden");
    });

    it("returns 404 for unknown channel", async () => {
      const res = await app.request("/api/v10/channels/nonexistent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "nope" }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── State DELETE ───────────────────────────────────────────────────────

  describe("DELETE /api/v10/channels/:id/state/:key", () => {
    it("deletes a state entry and returns 204", async () => {
      // Create state first
      await app.request("/api/v10/channels/garden/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "temp", value: "42" }),
      });
      broadcastEvents.length = 0;

      const res = await app.request("/api/v10/channels/garden/state/temp", {
        method: "DELETE",
      });
      expect(res.status).toBe(204);

      // Verify STATE_DELETE broadcast
      expect(broadcastEvents).toHaveLength(1);
      const event = broadcastEvents[0] as { op: number; t: string; d: { scene_id: string; key: string } };
      expect(event.t).toBe("STATE_DELETE");
      expect(event.d.scene_id).toBe("garden");
      expect(event.d.key).toBe("temp");

      // Verify state is gone
      const getRes = await app.request("/api/v10/channels/garden/state");
      const state: SceneState[] = await getRes.json();
      expect(state).toHaveLength(0);
    });

    it("returns 404 for nonexistent key", async () => {
      const res = await app.request("/api/v10/channels/garden/state/nonexistent", {
        method: "DELETE",
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── Users (Bot Users) ───────────────────────────────────────────────

  describe("User CRUD (Discord-compatible)", () => {
    it("POST /users creates a bot user", async () => {
      const res = await app.request("/api/v10/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "kagura",
          username: "Kagura",
          avatar: "🌸",
          bio: "AI assistant",
          backend: "openclaw",
          backend_config: { agentId: "kagura", endpoint: "ws://localhost:3000" },
        }),
      });
      expect(res.status).toBe(201);
      const user: CoveAgent = await res.json();
      expect(user.id).toBe("kagura");
      expect(user.username).toBe("Kagura");
      expect(user.avatar).toBe("🌸");
      expect(user.bot).toBe(true);
      expect(user.backend).toBe("openclaw");
      expect(user.backend_config).toEqual({ agentId: "kagura", endpoint: "ws://localhost:3000" });
    });

    it("POST auto-generates ID from username", async () => {
      const res = await app.request("/api/v10/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "Test Bot" }),
      });
      expect(res.status).toBe(201);
      const user: CoveAgent = await res.json();
      expect(user.id).toBe("test-bot");
    });

    it("POST returns 409 for duplicate ID", async () => {
      await app.request("/api/v10/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "dup", username: "First" }),
      });
      const res = await app.request("/api/v10/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "dup", username: "Second" }),
      });
      expect(res.status).toBe(409);
    });

    it("GET /users/:id returns a user", async () => {
      await app.request("/api/v10/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "solo", username: "Solo" }),
      });

      const res = await app.request("/api/v10/users/solo");
      expect(res.status).toBe(200);
      const user: CoveAgent = await res.json();
      expect(user.id).toBe("solo");
      expect(user.bot).toBe(true);
    });

    it("GET /users/:id returns 404 for unknown", async () => {
      const res = await app.request("/api/v10/users/nonexistent");
      expect(res.status).toBe(404);
    });

    it("PATCH updates user fields", async () => {
      await app.request("/api/v10/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "patchme", username: "Original" }),
      });

      const res = await app.request("/api/v10/users/patchme", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "Updated", bio: "New bio" }),
      });
      expect(res.status).toBe(200);
      const user: CoveAgent = await res.json();
      expect(user.username).toBe("Updated");
      expect(user.bio).toBe("New bio");
    });

    it("PATCH switches backend", async () => {
      await app.request("/api/v10/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "switchme", username: "Switch", backend: "openclaw" }),
      });

      const res = await app.request("/api/v10/users/switchme", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backend: "hermes", backend_config: { url: "http://hermes:8000" } }),
      });
      expect(res.status).toBe(200);
      const user: CoveAgent = await res.json();
      expect(user.backend).toBe("hermes");
      expect(user.backend_config).toEqual({ url: "http://hermes:8000" });
    });

    it("DELETE removes a user", async () => {
      await app.request("/api/v10/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "deleteme", username: "Delete" }),
      });

      const res = await app.request("/api/v10/users/deleteme", { method: "DELETE" });
      expect(res.status).toBe(204);

      const getRes = await app.request("/api/v10/users/deleteme");
      expect(getRes.status).toBe(404);
    });
  });

  // ─── Guild Members (Discord-compatible) ─────────────────────────────

  describe("Guild Members (Discord-compatible)", () => {
    beforeEach(async () => {
      await app.request("/api/v10/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "bot-a", username: "Bot A" }),
      });
      await app.request("/api/v10/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "bot-b", username: "Bot B" }),
      });
    });

    it("PUT adds user to guild", async () => {
      const res = await app.request("/api/v10/guilds/cove/members/bot-a", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(201);
      const member: CoveGuildMember = await res.json();
      expect(member.user.id).toBe("bot-a");
      expect(member.user.username).toBe("Bot A");
      expect(member.roles).toEqual([]);
      expect(member.joined_at).toBeTruthy();
    });

    it("PUT with nick and roles", async () => {
      const res = await app.request("/api/v10/guilds/cove/members/bot-a", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nick: "Gardener Bot", roles: ["gardener"] }),
      });
      expect(res.status).toBe(201);
      const member: CoveGuildMember = await res.json();
      expect(member.nick).toBe("Gardener Bot");
      expect(member.roles).toEqual(["gardener"]);
    });

    it("PUT returns existing member for duplicate", async () => {
      await app.request("/api/v10/guilds/cove/members/bot-a", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await app.request("/api/v10/guilds/cove/members/bot-a", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
    });

    it("GET lists guild members", async () => {
      await app.request("/api/v10/guilds/cove/members/bot-a", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await app.request("/api/v10/guilds/cove/members/bot-b", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await app.request("/api/v10/guilds/cove/members");
      expect(res.status).toBe(200);
      const members: CoveGuildMember[] = await res.json();
      expect(members).toHaveLength(2);
      expect(members[0].user.bot).toBe(true);
    });

    it("GET returns 404 for unknown guild", async () => {
      const res = await app.request("/api/v10/guilds/unknown/members");
      expect(res.status).toBe(404);
    });

    it("DELETE removes member from guild", async () => {
      await app.request("/api/v10/guilds/cove/members/bot-a", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await app.request("/api/v10/guilds/cove/members/bot-a", { method: "DELETE" });
      expect(res.status).toBe(204);

      const listRes = await app.request("/api/v10/guilds/cove/members");
      const members: CoveGuildMember[] = await listRes.json();
      expect(members).toHaveLength(0);
    });

    it("deleting user cascades to guild membership", async () => {
      await app.request("/api/v10/guilds/cove/members/bot-a", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      await app.request("/api/v10/users/bot-a", { method: "DELETE" });

      const listRes = await app.request("/api/v10/guilds/cove/members");
      const members: CoveGuildMember[] = await listRes.json();
      expect(members).toHaveLength(0);
    });
  });

  // ─── Gateway discovery ────────────────────────────────────────────────

  describe("GET /api/v10/gateway", () => {
    it("returns WebSocket URL", async () => {
      const res = await app.request("/api/v10/gateway");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.url).toBe("ws://localhost:3000/gateway");
    });
  });

  // ─── Users ────────────────────────────────────────────────────────────

  describe("GET /api/v10/users/@me", () => {
    it("returns bot user info from auth header", async () => {
      const res = await app.request("/api/v10/users/@me", {
        headers: { Authorization: "Bot kagura" },
      });
      expect(res.status).toBe(200);
      const user = await res.json();
      expect(user.id).toBe("kagura");
      expect(user.username).toBe("kagura");
      expect(user.bot).toBe(true);
    });

    it("returns anonymous when no auth", async () => {
      const res = await app.request("/api/v10/users/@me");
      expect(res.status).toBe(200);
      const user = await res.json();
      expect(user.id).toBe("anonymous");
      expect(user.username).toBe("anonymous");
    });
  });

  // ─── Health ───────────────────────────────────────────────────────────

  describe("GET /api/health", () => {
    it("returns ok", async () => {
      const res = await app.request("/api/health");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ status: "ok" });
    });
  });
});
