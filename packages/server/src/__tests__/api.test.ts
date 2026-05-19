import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedScenes } from "../db/schema.js";
import type Database from "better-sqlite3";
import type { Scene, Message, SceneState } from "@cove/shared";

describe("Cove API", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = initDb(":memory:");
    seedScenes(db);
    app = createApp(db);
  });

  describe("GET /api/scenes", () => {
    it("returns all 19 scenes", async () => {
      const res = await app.request("/api/scenes");
      expect(res.status).toBe(200);
      const scenes: Scene[] = await res.json();
      expect(scenes).toHaveLength(19);
    });

    it("each scene has required fields", async () => {
      const res = await app.request("/api/scenes");
      const scenes: Scene[] = await res.json();
      for (const scene of scenes) {
        expect(scene.id).toBeTruthy();
        expect(scene.name).toBeTruthy();
        expect(scene.icon).toBeTruthy();
        expect(scene.channelId).toBeTruthy();
        expect(scene.position).toBeDefined();
        expect(typeof scene.position.x).toBe("number");
        expect(typeof scene.position.y).toBe("number");
      }
    });
  });

  describe("GET /api/scenes/:id", () => {
    it("returns a specific scene with messages", async () => {
      const res = await app.request("/api/scenes/garden");
      expect(res.status).toBe(200);
      const data: { scene: Scene; messages: Message[] } = await res.json();
      expect(data.scene.id).toBe("garden");
      expect(data.scene.name).toBe("Garden");
      expect(data.scene.channelId).toBe("garden");
      expect(data.messages).toEqual([]);
    });

    it("returns 404 for unknown scene", async () => {
      const res = await app.request("/api/scenes/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/scenes/:id/messages", () => {
    it("creates a message and returns it", async () => {
      const res = await app.request("/api/scenes/garden/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender: "kagura", content: "The roses look beautiful today!" }),
      });
      expect(res.status).toBe(201);
      const msg: Message = await res.json();
      expect(msg.sceneId).toBe("garden");
      expect(msg.sender).toBe("kagura");
      expect(msg.content).toBe("The roses look beautiful today!");
      expect(msg.id).toBeTruthy();
      expect(msg.timestamp).toBeGreaterThan(0);
    });

    it("message appears in scene detail", async () => {
      await app.request("/api/scenes/garden/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender: "kagura", content: "Watering the plants" }),
      });

      const res = await app.request("/api/scenes/garden");
      const data: { scene: Scene; messages: Message[] } = await res.json();
      expect(data.messages).toHaveLength(1);
      expect(data.messages[0].content).toBe("Watering the plants");
    });

    it("returns 404 for unknown scene", async () => {
      const res = await app.request("/api/scenes/nonexistent/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender: "test", content: "hello" }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("Scene state", () => {
    it("PUT creates state entry, GET retrieves it", async () => {
      const putRes = await app.request("/api/scenes/garden/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "flowers_watered", value: "3" }),
      });
      expect(putRes.status).toBe(200);
      const entry: SceneState = await putRes.json();
      expect(entry.sceneId).toBe("garden");
      expect(entry.key).toBe("flowers_watered");
      expect(entry.value).toBe("3");

      const getRes = await app.request("/api/scenes/garden/state");
      const state: SceneState[] = await getRes.json();
      expect(state).toHaveLength(1);
      expect(state[0].key).toBe("flowers_watered");
      expect(state[0].value).toBe("3");
    });

    it("PUT updates existing state entry", async () => {
      await app.request("/api/scenes/garden/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "flowers_watered", value: "3" }),
      });
      await app.request("/api/scenes/garden/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "flowers_watered", value: "5" }),
      });

      const getRes = await app.request("/api/scenes/garden/state");
      const state: SceneState[] = await getRes.json();
      expect(state).toHaveLength(1);
      expect(state[0].value).toBe("5");
    });
  });

  describe("GET /api/health", () => {
    it("returns ok", async () => {
      const res = await app.request("/api/health");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ status: "ok" });
    });
  });
});
