import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import type { AppEnv } from "../auth.js";
import { validateString, validationError, parseJsonBody } from "../validation.js";
import { requireChannelPermission, unknownChannel } from "./helpers.js";
import { PermissionBits } from "@cove/shared";
import { computePermissions } from "../permissions/compute.js";

export function threadRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Create thread from message
  app.post("/channels/:channelId/messages/:messageId/threads", async (c) => {
    const channelId = c.req.param("channelId");
    const messageId = c.req.param("messageId");
    const user = c.get("botUser");

    const channel = await requireChannelPermission(repos, channelId, user.id, PermissionBits.CREATE_PUBLIC_THREADS | PermissionBits.VIEW_CHANNEL);
    if (channel.type === 11) {
      return c.json({ message: 'Cannot create a thread inside a thread', code: 50035 }, 400);
    }

    const body = await parseJsonBody<{ name: string; auto_archive_duration?: number }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const nameErr = validateString(body.name, "name", { required: true, maxLength: 100 });
    if (nameErr) return validationError(c, nameErr);

    if (body.auto_archive_duration !== undefined) {
      const valid = [60, 1440, 4320, 10080];
      if (!valid.includes(body.auto_archive_duration)) {
        return validationError(c, "auto_archive_duration must be one of 60, 1440, 4320, 10080");
      }
    }

    // Verify message exists in this channel
    const msg = repos.messages.getById(channelId, messageId);
    if (!msg) {
      return c.json({ message: "Unknown Message", code: 10008 }, 404);
    }

    // Verify no thread already exists for that message
    const existingThread = repos.threads.getThreadForMessage(messageId);
    if (existingThread) {
      return c.json({ message: "Thread already exists for this message", code: 160004 }, 400);
    }

    const thread = repos.threads.createFromMessage(
      channel.guild_id,
      channelId,
      messageId,
      body.name.trim(),
      user.id,
      body.auto_archive_duration,
    );

    dispatcher?.threadCreate(thread);

    return c.json(thread, 201);
  });

  // Create standalone thread
  app.post("/channels/:channelId/threads", async (c) => {
    const channelId = c.req.param("channelId");
    const user = c.get("botUser");

    const channel = await requireChannelPermission(repos, channelId, user.id, PermissionBits.CREATE_PUBLIC_THREADS | PermissionBits.VIEW_CHANNEL);
    if (channel.type === 11) {
      return c.json({ message: 'Cannot create a thread inside a thread', code: 50035 }, 400);
    }

    const body = await parseJsonBody<{ name: string; auto_archive_duration?: number }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const nameErr = validateString(body.name, "name", { required: true, maxLength: 100 });
    if (nameErr) return validationError(c, nameErr);

    if (body.auto_archive_duration !== undefined) {
      const valid = [60, 1440, 4320, 10080];
      if (!valid.includes(body.auto_archive_duration)) {
        return validationError(c, "auto_archive_duration must be one of 60, 1440, 4320, 10080");
      }
    }

    const thread = repos.threads.createStandalone(
      channel.guild_id,
      channelId,
      body.name.trim(),
      user.id,
      body.auto_archive_duration,
    );

    dispatcher?.threadCreate(thread);

    return c.json(thread, 201);
  });

  // List active threads in channel
  app.get("/channels/:channelId/threads/active", async (c) => {
    const channelId = c.req.param("channelId");
    const user = c.get("botUser");

    await requireChannelPermission(repos, channelId, user.id, PermissionBits.VIEW_CHANNEL);

    const threads = repos.threads.listActiveByChannel(channelId);
    return c.json({ threads, has_more: false });
  });

  // List archived threads in channel
  app.get("/channels/:channelId/threads/archived/public", async (c) => {
    const channelId = c.req.param("channelId");
    const user = c.get("botUser");

    await requireChannelPermission(repos, channelId, user.id, PermissionBits.VIEW_CHANNEL);

    const threads = repos.threads.listArchivedByChannel(channelId);
    return c.json({ threads, has_more: false });
  });

  // List active threads in guild
  app.get("/guilds/:guildId/threads/active", (c) => {
    const guildId = c.req.param("guildId");
    const user = c.get("botUser");

    const guild = repos.guilds.getById(guildId);
    if (!guild) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }
    const member = repos.members.get(guildId, user.id);
    if (!member) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }

    const roles = repos.roles.listByGuild(guildId);
    let threads = repos.threads.listActiveByGuild(guildId);
    // Filter threads by parent channel permissions
    threads = threads.filter(t => {
      if (!t.parent_id) return false;
      const overwriteChannelId = t.type === 11 && t.parent_id ? t.parent_id : t.id;
      const overwrites = repos.permissions.listByChannel(overwriteChannelId);
      const parentChannel = repos.channels.getById(t.parent_id);
      if (!parentChannel) return false;
      const perms = computePermissions(member, parentChannel, guild, roles, overwrites);
      return (perms & PermissionBits.VIEW_CHANNEL) !== 0n;
    });
    return c.json({ threads, has_more: false });
  });

  // Join thread
  app.put("/channels/:threadId/thread-members/@me", async (c) => {
    const threadId = c.req.param("threadId");
    const user = c.get("botUser");

    const thread = repos.channels.getById(threadId);
    if (!thread || thread.type !== 11) return unknownChannel(c);

    await requireChannelPermission(repos, threadId, user.id, PermissionBits.VIEW_CHANNEL);

    repos.threads.addMember(threadId, user.id);
    dispatcher?.threadMemberUpdate(threadId, user.id, thread.guild_id);

    return c.body(null, 204);
  });

  // Leave thread
  app.delete("/channels/:threadId/thread-members/@me", async (c) => {
    const threadId = c.req.param("threadId");
    const user = c.get("botUser");

    const thread = repos.channels.getById(threadId);
    if (!thread || thread.type !== 11) return unknownChannel(c);

    await requireChannelPermission(repos, threadId, user.id, PermissionBits.VIEW_CHANNEL);

    repos.threads.removeMember(threadId, user.id);
    dispatcher?.threadMemberUpdate(threadId, user.id, thread.guild_id);

    return c.body(null, 204);
  });

  // Add user to thread
  app.put("/channels/:threadId/thread-members/:userId", async (c) => {
    const threadId = c.req.param("threadId");
    const userId = c.req.param("userId");
    const user = c.get("botUser");

    const thread = await requireChannelPermission(repos, threadId, user.id, PermissionBits.VIEW_CHANNEL);

    // Verify target user exists in the guild
    if (!repos.members.exists(thread.guild_id, userId)) {
      return c.json({ message: "Unknown Member", code: 10007 }, 404);
    }

    const added = repos.threads.addMember(threadId, userId);
    if (added) {
      dispatcher?.threadMembersUpdate(threadId, thread.guild_id, [userId], []);
    }

    return c.body(null, 204);
  });

  // List thread members
  app.get("/channels/:threadId/thread-members", async (c) => {
    const threadId = c.req.param("threadId");
    const user = c.get("botUser");

    await requireChannelPermission(repos, threadId, user.id, PermissionBits.VIEW_CHANNEL);

    const members = repos.threads.listMembers(threadId);
    return c.json(members);
  });

  return app;
}
