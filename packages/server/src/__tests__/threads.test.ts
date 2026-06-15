import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../app.js";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";
import type Database from "better-sqlite3";
import type { Channel, Message } from "@cove/shared";
import { API_PREFIX } from "@cove/shared";
import { GatewayDispatcher } from "../ws/dispatcher.js";

describe("Cove API — Threads", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  const broadcastEvents: { t: string; d: unknown }[] = [];
  let adminToken: string;
  let defaultGuildId: string;
  let generalId: string;

  class TestDispatcher extends GatewayDispatcher {
    constructor() {
      super({ getById: () => null } as any);
    }
    override messageCreate(message: Message): void {
      broadcastEvents.push({ t: "MESSAGE_CREATE", d: message });
    }
    override messageUpdate(message: Message): void {
      broadcastEvents.push({ t: "MESSAGE_UPDATE", d: message });
    }
    override messageDelete(channelId: string, messageId: string): void {
      broadcastEvents.push({ t: "MESSAGE_DELETE", d: { id: messageId, channel_id: channelId } });
    }
    override channelUpdate(channel: Channel): void {
      broadcastEvents.push({ t: "CHANNEL_UPDATE", d: channel });
    }
    override channelCreate(channel: Channel): void {
      broadcastEvents.push({ t: "CHANNEL_CREATE", d: channel });
    }
    override channelDelete(guildId: string, channelId: string): void {
      broadcastEvents.push({ t: "CHANNEL_DELETE", d: { id: channelId, guild_id: guildId } });
    }
    override threadCreate(thread: Channel): void {
      broadcastEvents.push({ t: "THREAD_CREATE", d: thread });
    }
    override threadUpdate(thread: Channel): void {
      broadcastEvents.push({ t: "THREAD_UPDATE", d: thread });
    }
    override threadDelete(thread: Channel): void {
      broadcastEvents.push({ t: "THREAD_DELETE", d: thread });
    }
    override threadMemberUpdate(threadId: string, userId: string, guildId: string): void {
      broadcastEvents.push({ t: "THREAD_MEMBER_UPDATE", d: { id: threadId, user_id: userId, guild_id: guildId } });
    }
    override threadMembersUpdate(threadId: string, guildId: string, addedMembers: string[], removedMembers: string[]): void {
      broadcastEvents.push({ t: "THREAD_MEMBERS_UPDATE", d: { id: threadId, guild_id: guildId, added_members: addedMembers, removed_members: removedMembers } });
    }
    override typingStart(): void {}
    override messageAck(): void {}
  }

  beforeEach(() => {
    db = initDb(":memory:");
    defaultGuildId = (db.prepare("SELECT id FROM guilds ORDER BY created_at ASC LIMIT 1").get() as { id: string }).id;
    seedChannels(db, defaultGuildId);
    generalId = (db.prepare("SELECT id FROM channels WHERE name = 'general'").get() as { id: string }).id;
    broadcastEvents.length = 0;
    process.env.RATE_LIMIT_ENABLED = "false";
    app = createApp(db, createRepos(db), new TestDispatcher());

    // Bootstrap admin user
    adminToken = "test-admin-token";
    const now = Date.now();
    db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("admin", "Admin", null, 0, null, adminToken, now, now);
    db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(defaultGuildId, "admin", null, "[]", now);
  });

  afterEach(() => {
    delete process.env.RATE_LIMIT_ENABLED;
  });

  const authHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${adminToken}`,
  });

  const authGet = (path: string) => app.request(path, { headers: { Authorization: `Bearer ${adminToken}` } });

  /** Post a message to a channel and return the created message. */
  async function postMessage(channelId: string, content: string): Promise<Message> {
    const res = await app.request(`${API_PREFIX}/channels/${channelId}/messages`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ content }),
    });
    return res.json() as Promise<Message>;
  }

  /** Create a thread from a message. */
  async function createThreadFromMessage(channelId: string, messageId: string, name: string, opts?: { auto_archive_duration?: number }) {
    return app.request(`${API_PREFIX}/channels/${channelId}/messages/${messageId}/threads`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name, ...opts }),
    });
  }

  /** Create a standalone thread. */
  async function createStandaloneThread(channelId: string, name: string, opts?: { auto_archive_duration?: number }) {
    return app.request(`${API_PREFIX}/channels/${channelId}/threads`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name, ...opts }),
    });
  }

  // ─── POST /channels/:channelId/messages/:messageId/threads ─────────────

  describe(`POST ${API_PREFIX}/channels/:channelId/messages/:messageId/threads`, () => {
    it("creates a thread with correct type, parent_id, and message_id", async () => {
      const msg = await postMessage(generalId, "thread parent");
      const res = await createThreadFromMessage(generalId, msg.id, "my thread");

      expect(res.status).toBe(201);
      const thread: Channel = await res.json();
      expect(thread.type).toBe(11);
      expect(thread.parent_id).toBe(generalId);
      expect(thread.message_id).toBe(msg.id);
      expect(thread.name).toBe("my thread");
      expect(thread.guild_id).toBe(defaultGuildId);
      expect(thread.owner_id).toBe("admin");
      expect(thread.message_count).toBe(0);
      expect(thread.member_count).toBe(1);
      expect(thread.thread_metadata).toBeDefined();
      expect(thread.thread_metadata!.archived).toBe(false);
      expect(thread.thread_metadata!.locked).toBe(false);
      expect(thread.thread_metadata!.auto_archive_duration).toBe(1440);
      expect(thread.thread_metadata!.create_timestamp).toBeTruthy();
    });

    it("returns 201 with the thread channel object", async () => {
      const msg = await postMessage(generalId, "hello");
      const res = await createThreadFromMessage(generalId, msg.id, "test thread");
      expect(res.status).toBe(201);
      const thread: Channel = await res.json();
      expect(thread.id).toBeTruthy();
      expect(thread.type).toBe(11);
    });

    it("auto-adds creator as thread member", async () => {
      const msg = await postMessage(generalId, "parent msg");
      const res = await createThreadFromMessage(generalId, msg.id, "auto-member thread");
      const thread: Channel = await res.json();

      // Verify member count is 1
      expect(thread.member_count).toBe(1);

      // Verify via list members endpoint
      const membersRes = await authGet(`${API_PREFIX}/channels/${thread.id}/thread-members`);
      expect(membersRes.status).toBe(200);
      const members = await membersRes.json();
      expect(members).toHaveLength(1);
      expect(members[0].user_id).toBe("admin");
    });

    it("fails with invalid auto_archive_duration", async () => {
      const msg = await postMessage(generalId, "bad duration");
      const res = await createThreadFromMessage(generalId, msg.id, "bad thread", {
        auto_archive_duration: 999,
      });
      expect(res.status).toBe(400);
    });

    it("fails if message does not exist", async () => {
      const res = await createThreadFromMessage(generalId, "nonexistent-msg", "no msg thread");
      expect(res.status).toBe(404);
    });

    it("fails if thread already exists for that message", async () => {
      const msg = await postMessage(generalId, "duplicate parent");
      const first = await createThreadFromMessage(generalId, msg.id, "first thread");
      expect(first.status).toBe(201);

      const second = await createThreadFromMessage(generalId, msg.id, "second thread");
      expect(second.status).toBe(400);
    });

    it("accepts valid auto_archive_duration values", async () => {
      const validDurations = [60, 1440, 4320, 10080];
      for (const duration of validDurations) {
        const msg = await postMessage(generalId, `dur-${duration}`);
        const res = await createThreadFromMessage(generalId, msg.id, `thread-${duration}`, {
          auto_archive_duration: duration,
        });
        expect(res.status).toBe(201);
        const thread: Channel = await res.json();
        expect(thread.thread_metadata!.auto_archive_duration).toBe(duration);
      }
    });

    it("trims whitespace from thread name", async () => {
      const msg = await postMessage(generalId, "trim test");
      const res = await createThreadFromMessage(generalId, msg.id, "  trimmed  ");
      expect(res.status).toBe(201);
      const thread: Channel = await res.json();
      expect(thread.name).toBe("trimmed");
    });
  });

  // ─── POST /channels/:channelId/threads ──────────────────────────────────

  describe(`POST ${API_PREFIX}/channels/:channelId/threads`, () => {
    it("creates a standalone thread with no message_id", async () => {
      const res = await createStandaloneThread(generalId, "standalone");
      expect(res.status).toBe(201);
      const thread: Channel = await res.json();
      expect(thread.type).toBe(11);
      expect(thread.parent_id).toBe(generalId);
      expect(thread.name).toBe("standalone");
      expect(thread.owner_id).toBe("admin");
      expect(thread.message_count).toBe(0);
      expect(thread.member_count).toBe(1);
      // standalone thread has no message_id
      expect(thread.message_id).toBeFalsy();
    });

    it("requires name", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/threads`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("rejects name over 100 chars", async () => {
      const res = await createStandaloneThread(generalId, "x".repeat(101));
      expect(res.status).toBe(400);
    });

    it("accepts name at exactly 100 chars", async () => {
      const res = await createStandaloneThread(generalId, "x".repeat(100));
      expect(res.status).toBe(201);
    });

    it("validates auto_archive_duration", async () => {
      const res = await createStandaloneThread(generalId, "bad duration", {
        auto_archive_duration: 999,
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /channels/:channelId/threads/active ────────────────────────────

  describe(`GET ${API_PREFIX}/channels/:channelId/threads/active`, () => {
    it("returns active (non-archived) threads", async () => {
      const msg = await postMessage(generalId, "thread parent");
      const createRes = await createThreadFromMessage(generalId, msg.id, "active thread");
      const thread: Channel = await createRes.json();

      const res = await authGet(`${API_PREFIX}/channels/${generalId}/threads/active`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.threads).toHaveLength(1);
      expect(body.threads[0].id).toBe(thread.id);
      expect(body.threads[0].name).toBe("active thread");
      expect(body.has_more).toBe(false);
    });

    it("returns empty when no threads exist", async () => {
      const res = await authGet(`${API_PREFIX}/channels/${generalId}/threads/active`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.threads).toHaveLength(0);
      expect(body.has_more).toBe(false);
    });

    it("returns multiple active threads", async () => {
      const msg1 = await postMessage(generalId, "parent 1");
      const msg2 = await postMessage(generalId, "parent 2");
      await createThreadFromMessage(generalId, msg1.id, "thread 1");
      await createThreadFromMessage(generalId, msg2.id, "thread 2");

      const res = await authGet(`${API_PREFIX}/channels/${generalId}/threads/active`);
      const body = await res.json();
      expect(body.threads).toHaveLength(2);
    });
  });

  // ─── PUT /channels/:threadId/thread-members/@me ─────────────────────────

  describe(`PUT ${API_PREFIX}/channels/:threadId/thread-members/@me`, () => {
    it("adds user as member and returns 204", async () => {
      const msg = await postMessage(generalId, "join test parent");
      const createRes = await createThreadFromMessage(generalId, msg.id, "join thread");
      const thread: Channel = await createRes.json();

      // Create a second user to join
      const now = Date.now();
      const secondToken = "second-user-token";
      db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("user2", "User2", null, 0, null, secondToken, now, now);
      db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
        .run(defaultGuildId, "user2", null, "[]", now);

      const joinRes = await app.request(`${API_PREFIX}/channels/${thread.id}/thread-members/@me`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${secondToken}` },
      });
      expect(joinRes.status).toBe(204);

      // Verify membership
      const membersRes = await authGet(`${API_PREFIX}/channels/${thread.id}/thread-members`);
      const members = await membersRes.json();
      expect(members).toHaveLength(2);
      const userIds = members.map((m: { user_id: string }) => m.user_id);
      expect(userIds).toContain("admin");
      expect(userIds).toContain("user2");
    });

    it("returns 404 for non-thread channel", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/thread-members/@me`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── DELETE /channels/:threadId/thread-members/@me ──────────────────────

  describe(`DELETE ${API_PREFIX}/channels/:threadId/thread-members/@me`, () => {
    it("removes member and returns 204", async () => {
      const msg = await postMessage(generalId, "leave test parent");
      const createRes = await createThreadFromMessage(generalId, msg.id, "leave thread");
      const thread: Channel = await createRes.json();

      // Admin is auto-added as member, now leave
      const leaveRes = await app.request(`${API_PREFIX}/channels/${thread.id}/thread-members/@me`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(leaveRes.status).toBe(204);

      // Verify membership removed
      const membersRes = await authGet(`${API_PREFIX}/channels/${thread.id}/thread-members`);
      const members = await membersRes.json();
      const userIds = members.map((m: { user_id: string }) => m.user_id);
      expect(userIds).not.toContain("admin");
    });

    it("returns 404 for non-thread channel", async () => {
      const res = await app.request(`${API_PREFIX}/channels/${generalId}/thread-members/@me`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── GET /channels/:threadId/thread-members ─────────────────────────────

  describe(`GET ${API_PREFIX}/channels/:threadId/thread-members`, () => {
    it("lists all thread members", async () => {
      const msg = await postMessage(generalId, "members test parent");
      const createRes = await createThreadFromMessage(generalId, msg.id, "members thread");
      const thread: Channel = await createRes.json();

      // Add second user
      const now = Date.now();
      const secondToken = "member-list-token";
      db.prepare("INSERT INTO users (id, username, avatar, bot, bio, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("user-ml", "MemberListUser", null, 0, null, secondToken, now, now);
      db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, nick, roles, joined_at) VALUES (?, ?, ?, ?, ?)")
        .run(defaultGuildId, "user-ml", null, "[]", now);

      await app.request(`${API_PREFIX}/channels/${thread.id}/thread-members/@me`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${secondToken}` },
      });

      const res = await authGet(`${API_PREFIX}/channels/${thread.id}/thread-members`);
      expect(res.status).toBe(200);
      const members = await res.json();
      expect(members).toHaveLength(2);

      // Each member should have user_id and join_timestamp
      for (const member of members) {
        expect(member.user_id).toBeTruthy();
        expect(member.join_timestamp).toBeTruthy();
      }
    });

    it("returns 404 for non-thread channel", async () => {
      const res = await authGet(`${API_PREFIX}/channels/${generalId}/thread-members`);
      expect(res.status).toBe(404);
    });
  });

  // ─── PATCH /channels/:threadId (archive) ───────────────────────────────

  describe(`PATCH ${API_PREFIX}/channels/:threadId (archive)`, () => {
    it("archives a thread by setting thread_metadata.archived to true", async () => {
      const msg = await postMessage(generalId, "archive parent");
      const createRes = await createThreadFromMessage(generalId, msg.id, "archive thread");
      const thread: Channel = await createRes.json();

      const patchRes = await app.request(`${API_PREFIX}/channels/${thread.id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ archived: true }),
      });
      expect(patchRes.status).toBe(200);
      const updated: Channel = await patchRes.json();
      expect(updated.thread_metadata!.archived).toBe(true);
      expect(updated.thread_metadata!.archive_timestamp).toBeTruthy();
    });

    it("archived thread does not appear in active list", async () => {
      const msg1 = await postMessage(generalId, "archive filter parent 1");
      const msg2 = await postMessage(generalId, "archive filter parent 2");
      const res1 = await createThreadFromMessage(generalId, msg1.id, "active thread");
      const res2 = await createThreadFromMessage(generalId, msg2.id, "archived thread");
      const thread2: Channel = await res2.json();
      await res1.json(); // consume body

      // Archive thread 2
      await app.request(`${API_PREFIX}/channels/${thread2.id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ archived: true }),
      });

      // Only active thread should appear
      const activeRes = await authGet(`${API_PREFIX}/channels/${generalId}/threads/active`);
      const body = await activeRes.json();
      expect(body.threads).toHaveLength(1);
      expect(body.threads[0].name).toBe("active thread");
    });

    it("can unarchive a thread", async () => {
      const msg = await postMessage(generalId, "unarchive parent");
      const createRes = await createThreadFromMessage(generalId, msg.id, "unarchive thread");
      const thread: Channel = await createRes.json();

      // Archive
      await app.request(`${API_PREFIX}/channels/${thread.id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ archived: true }),
      });

      // Unarchive
      const patchRes = await app.request(`${API_PREFIX}/channels/${thread.id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ archived: false }),
      });
      expect(patchRes.status).toBe(200);
      const updated: Channel = await patchRes.json();
      expect(updated.thread_metadata!.archived).toBe(false);

      // Should appear in active list again
      const activeRes = await authGet(`${API_PREFIX}/channels/${generalId}/threads/active`);
      const body = await activeRes.json();
      expect(body.threads.some((t: Channel) => t.id === thread.id)).toBe(true);
    });
  });

  // ─── Thread message enrichment ──────────────────────────────────────────

  describe("Thread message enrichment — GET messages", () => {
    it("messages with threads include thread field", async () => {
      const msg = await postMessage(generalId, "enrichment parent");
      const createRes = await createThreadFromMessage(generalId, msg.id, "enrichment thread");
      const thread: Channel = await createRes.json();

      // Fetch messages for the channel
      const res = await authGet(`${API_PREFIX}/channels/${generalId}/messages`);
      expect(res.status).toBe(200);
      const messages: Message[] = await res.json();
      const parentMsg = messages.find((m) => m.id === msg.id);
      expect(parentMsg).toBeDefined();
      expect(parentMsg!.thread).toBeDefined();
      expect(parentMsg!.thread!.id).toBe(thread.id);
      expect(parentMsg!.thread!.name).toBe("enrichment thread");
      expect(parentMsg!.thread!.message_count).toBe(0);
    });

    it("messages without threads have no thread field", async () => {
      await postMessage(generalId, "no thread here");

      const res = await authGet(`${API_PREFIX}/channels/${generalId}/messages`);
      const messages: Message[] = await res.json();
      expect(messages).toHaveLength(1);
      expect(messages[0].thread).toBeUndefined();
    });

    it("single message endpoint also includes thread field", async () => {
      const msg = await postMessage(generalId, "single enrichment");
      const createRes = await createThreadFromMessage(generalId, msg.id, "single thread");
      const thread: Channel = await createRes.json();

      const res = await authGet(`${API_PREFIX}/channels/${generalId}/messages/${msg.id}`);
      expect(res.status).toBe(200);
      const fetched: Message = await res.json();
      expect(fetched.thread).toBeDefined();
      expect(fetched.thread!.id).toBe(thread.id);
      expect(fetched.thread!.name).toBe("single thread");
    });

    it("thread message_count reflects posted messages", async () => {
      const msg = await postMessage(generalId, "counter parent");
      const createRes = await createThreadFromMessage(generalId, msg.id, "counter thread");
      const thread: Channel = await createRes.json();

      // Post messages inside the thread
      await app.request(`${API_PREFIX}/channels/${thread.id}/messages`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ content: "reply 1" }),
      });
      await app.request(`${API_PREFIX}/channels/${thread.id}/messages`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ content: "reply 2" }),
      });

      // Check enrichment reflects count
      const res = await authGet(`${API_PREFIX}/channels/${generalId}/messages/${msg.id}`);
      const fetched: Message = await res.json();
      expect(fetched.thread!.message_count).toBe(2);
    });
  });
});
