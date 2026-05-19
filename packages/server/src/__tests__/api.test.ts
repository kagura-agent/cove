import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedScenes } from "../db/schema.js";
import type Database from "better-sqlite3";
import type { DiscordChannel, DiscordMessage, SceneState } from "@cove/shared";

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
