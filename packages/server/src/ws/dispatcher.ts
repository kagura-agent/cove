import type { Message, Channel, Role, Task } from "@cove/shared";
import { PermissionBits } from "@cove/shared";
import type { GatewaySession } from "./session.js";
import type { ChannelsRepo } from "../repos/channels.js";
import type { GuildsRepo } from "../repos/guilds.js";
import type { PermissionsRepo } from "../repos/permissions.js";
import type { MembersRepo } from "../repos/members.js";
import type { RolesRepo } from "../repos/roles.js";
import { computePermissions } from "../permissions/compute.js";

const VIEW_CHANNEL_BIT = PermissionBits.VIEW_CHANNEL;

export class GatewayDispatcher {
  private sessions = new Set<GatewaySession>();
  private sessionsById = new Map<string, GatewaySession>();
  private userSessions = new Map<string, Set<string>>();
  private permissionsRepo: PermissionsRepo | null = null;
  private membersRepo: MembersRepo | null = null;
  private rolesRepo: RolesRepo | null = null;
  private activeTyping = new Map<string, { runId: string; expiresAt: number; abortRequested: boolean; abortRequestId?: string }>();
  private abortRequests = new Map<string, { channelId: string; targetUserId: string; requesterId: string; expiresAt: number }>();

  constructor(private channelsRepo: ChannelsRepo, private guildsRepo?: GuildsRepo) {}

  setPermissionsRepo(repo: PermissionsRepo): void {
    this.permissionsRepo = repo;
  }

  setMembersRepo(repo: MembersRepo): void {
    this.membersRepo = repo;
  }

  setRolesRepo(repo: RolesRepo): void {
    this.rolesRepo = repo;
  }

  addSession(session: GatewaySession): void {
    this.sessions.add(session);
    this.sessionsById.set(session.id, session);
    if (session.user) {
      const userId = session.user.id;
      if (!this.userSessions.has(userId)) {
        this.userSessions.set(userId, new Set());
      }
      this.userSessions.get(userId)!.add(session.id);
      if (this.userSessions.get(userId)!.size === 1) {
        this.presenceUpdate(userId, "online");
      }
    }
  }

  removeSession(session: GatewaySession): void {
    if (session.user) {
      const userId = session.user.id;
      const sessions = this.userSessions.get(userId);
      if (sessions) {
        sessions.delete(session.id);
        if (sessions.size === 0) {
          // Broadcast before removing indexes. Use dying session's guild IDs directly
          // since userSessions no longer contains it.
          this.broadcastToGuilds(session.guildIds, "PRESENCE_UPDATE", {
            user: { id: userId },
            status: "offline",
          }, session.id);
          this.userSessions.delete(userId);
        }
      }
    }
    this.sessions.delete(session);
    this.sessionsById.delete(session.id);
  }

  getOnlineUserIds(): string[] {
    return Array.from(this.userSessions.keys());
  }

  getSessionGuildIds(userId: string): string[] {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds) return [];
    const guildIds = new Set<string>();
    for (const sid of sessionIds) {
      const session = this.sessionsById.get(sid);
      if (session) {
        for (const gid of session.guildIds) {
          guildIds.add(gid);
        }
      }
    }
    return Array.from(guildIds);
  }

  messageCreate(message: Message): void {
    const guildId = this.resolveGuildForChannel(message.channel_id);
    if (!guildId) return;
    this.broadcastToGuildWithChannelFilter(guildId, message.channel_id, "MESSAGE_CREATE", { ...message, guild_id: guildId });
  }

  messageUpdate(message: Message): void {
    const guildId = this.resolveGuildForChannel(message.channel_id);
    if (!guildId) return;
    this.broadcastToGuildWithChannelFilter(guildId, message.channel_id, "MESSAGE_UPDATE", { ...message, guild_id: guildId });
  }

  messageDelete(channelId: string, messageId: string): void {
    const guildId = this.resolveGuildForChannel(channelId);
    if (!guildId) return;
    this.broadcastToGuildWithChannelFilter(guildId, channelId, "MESSAGE_DELETE", { id: messageId, channel_id: channelId, guild_id: guildId });
  }

  messageDeleteBulk(channelId: string, messageIds: string[], guildId: string): void {
    this.broadcastToGuildWithChannelFilter(guildId, channelId, "MESSAGE_DELETE_BULK", { ids: messageIds, channel_id: channelId, guild_id: guildId });
  }

  channelCreate(channel: Channel): void {
    this.broadcastToGuildWithChannelFilter(channel.guild_id, channel.id, "CHANNEL_CREATE", channel);
  }

  channelUpdate(channel: Channel): void {
    this.broadcastToGuildWithChannelFilter(channel.guild_id, channel.id, "CHANNEL_UPDATE", channel);
  }

  channelDelete(guildId: string, channelId: string): void {
    this.broadcastToGuild(guildId, "CHANNEL_DELETE", { id: channelId, guild_id: guildId });
  }

  typingStart(channelId: string, user: { id: string; username: string }, guildId: string, abortable = false): void {
    const now = Date.now();
    const key = `${channelId}:${user.id}`;
    const current = this.activeTyping.get(key);
    const continuingRun = Boolean(abortable && current && current.expiresAt > now);
    const runId = continuingRun ? current!.runId : `${now}-${Math.random().toString(36).slice(2, 10)}`;
    if (abortable) this.activeTyping.set(key, {
      runId, expiresAt: now + 8_000,
      abortRequested: continuingRun ? current!.abortRequested : false,
      abortRequestId: continuingRun ? current!.abortRequestId : undefined,
    });
    this.broadcastToGuildWithChannelFilter(guildId, channelId, "TYPING_START", {
      channel_id: channelId, user_id: user.id, username: user.username, timestamp: now,
      ...(abortable ? { abortable: true, run_id: runId } : {}),
    });
  }

  requestAgentAbort(channelId: string, targetUserId: string, runId: string, requester: { id: string; username: string }): { status: "requested" | "already_requested"; requestId: string } | { status: "already_requested" | "not_active" | "unavailable" } {
    const key = `${channelId}:${targetUserId}`;
    const active = this.activeTyping.get(key);
    if (!active || active.expiresAt <= Date.now() || active.runId !== runId) { this.activeTyping.delete(key); return { status: "not_active" }; }
    if (active.abortRequested) return active.abortRequestId ? { status: "already_requested", requestId: active.abortRequestId } : { status: "already_requested" };
    if (!this.userSessions.has(targetUserId)) return { status: "unavailable" };
    active.abortRequested = true;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    active.abortRequestId = requestId;
    this.abortRequests.set(requestId, { channelId, targetUserId, requesterId: requester.id, expiresAt: Date.now() + 15_000 });
    this.sendToUser(targetUserId, "AGENT_ABORT_REQUEST", { request_id: requestId, channel_id: channelId, target_user_id: targetUserId, requester });
    return { status: "requested", requestId };
  }

  agentAbortResult(requestId: string, targetUserId: string, status: "aborted" | "denied" | "failed"): boolean {
    const request = this.abortRequests.get(requestId);
    if (!request || request.targetUserId !== targetUserId || request.expiresAt <= Date.now()) return false;
    this.abortRequests.delete(requestId);
    if (status === "aborted") this.activeTyping.delete(`${request.channelId}:${targetUserId}`);
    else {
      const active = this.activeTyping.get(`${request.channelId}:${targetUserId}`);
      if (active?.abortRequestId === requestId) {
        active.abortRequested = false;
        active.abortRequestId = undefined;
      }
    }
    this.sendToUser(request.requesterId, "AGENT_ABORT_RESULT", { request_id: requestId, channel_id: request.channelId, target_user_id: targetUserId, status });
    return true;
  }

  messageAck(userId: string, channelId: string, messageId: string): void {
    this.sendToUser(userId, "MESSAGE_ACK", { channel_id: channelId, message_id: messageId });
  }

  private presenceUpdate(userId: string, status: "online" | "offline"): void {
    this.broadcastToGuildMembers(userId, "PRESENCE_UPDATE", {
      user: { id: userId },
      status,
    });
  }

  addGuildToUser(userId: string, guildId: string): void {
    const sessionIds = this.userSessions.get(userId);
    if (sessionIds) {
      for (const sid of sessionIds) {
        const session = this.sessionsById.get(sid);
        if (session) session.guildIds.add(guildId);
      }
    }
    // Notify the user's sessions about the new guild membership
    const guild = this.guildsRepo?.getById(guildId);
    if (guild) {
      this.sendToUser(userId, "GUILD_CREATE", guild);
    }
  }

  /**
   * Add guild to user sessions and dispatch GUILD_CREATE with full payload
   * (including channels and roles) so multi-tab and invite flows work.
   */
  guildCreateFull(userId: string, guildId: string, payload: unknown): void {
    const sessionIds = this.userSessions.get(userId);
    if (sessionIds) {
      for (const sid of sessionIds) {
        const session = this.sessionsById.get(sid);
        if (session) session.guildIds.add(guildId);
      }
    }
    this.sendToUser(userId, "GUILD_CREATE", payload);
  }

  removeGuildFromUser(userId: string, guildId: string): void {
    // Notify the user's sessions BEFORE removing the guild from their set
    this.sendToUser(userId, "GUILD_DELETE", { id: guildId });
    const sessionIds = this.userSessions.get(userId);
    if (sessionIds) {
      for (const sid of sessionIds) {
        const session = this.sessionsById.get(sid);
        if (session) session.guildIds.delete(guildId);
      }
    }
  }

  guildMemberAdd(guildId: string, member: { user: { id: string }; nick: string | null; roles: string[]; joined_at: string }): void {
    this.broadcastToGuild(guildId, "GUILD_MEMBER_ADD", { ...member, guild_id: guildId });
  }

  guildUpdate(guildId: string, guild: unknown): void {
    this.broadcastToGuild(guildId, "GUILD_UPDATE", guild);
  }

  guildDelete(guildId: string, memberUserIds: string[]): void {
    // Notify all affected members, then remove guild from their sessions
    for (const userId of memberUserIds) {
      this.removeGuildFromUser(userId, guildId);
    }
  }

  guildMemberRemove(guildId: string, userId: string): void {
    this.broadcastToGuild(guildId, "GUILD_MEMBER_REMOVE", { guild_id: guildId, user: { id: userId } });
  }

  private resolveGuildForChannel(channelId: string): string | null {
    // TODO(#111): DM channels have guild_id == null. When DMs are implemented,
    // add a broadcastToRecipients path that sends to DM participants directly.
    const channel = this.channelsRepo.getById(channelId);
    return channel?.guild_id ?? null;
  }

  private broadcastToGuild(guildId: string, event: string, data: unknown): void {
    for (const session of this.sessions) {
      if (session.guildIds.has(guildId)) {
        session.dispatch(event, data);
      }
    }
  }

  private broadcastToGuildWithChannelFilter(guildId: string, channelId: string, event: string, data: unknown): void {
    // For threads (type=11), permission overwrites live on the parent channel,
    // not the thread itself. Look up once before the loop.
    let permChannelId = channelId;
    const channel = this.channelsRepo.getById(channelId);
    if (channel?.parent_id && channel.type === 11) {
      permChannelId = channel.parent_id;
    }

    // Pre-load guild data once for all sessions
    const guild = this.guildsRepo?.getById(guildId);
    const roles = this.rolesRepo?.listByGuild(guildId);
    const permChannel = this.channelsRepo.getById(permChannelId);
    const channelOverwrites = this.permissionsRepo?.listByChannel(permChannelId) ?? [];

    for (const session of this.sessions) {
      if (!session.guildIds.has(guildId)) continue;

      // Permission filter: ALL sessions (bot and human) are filtered
      // Fail-closed: if we can't compute permissions, deny by default
      if (!session.user) continue;
      if (!guild || !roles || !permChannel || !this.membersRepo) continue;

      // Bot visibility is an explicit member allowlist. In particular, an
      // absent overwrite means hidden, even when a guild role has VIEW_CHANNEL.
      // Humans retain normal Discord-style computed permissions.
      if (session.user.bot) {
        if (!this.permissionsRepo?.hasPermission(permChannelId, session.user.id, VIEW_CHANNEL_BIT)) continue;
        session.dispatch(event, data);
        continue;
      }

      const member = this.membersRepo.get(guildId, session.user.id);
      if (!member) continue;

      const perms = computePermissions(member, permChannel, guild, roles, channelOverwrites);
      if (!(perms & VIEW_CHANNEL_BIT)) continue;

      session.dispatch(event, data);
    }
  }

  private sendToUser(userId: string, event: string, data: unknown): void {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds) return;
    for (const sid of sessionIds) {
      const session = this.sessionsById.get(sid);
      if (session) session.dispatch(event, data);
    }
  }

  /** Get online users who share at least one guild with the given guild set. Single-pass O(sessions). */
  getSharedGuildPresences(guildIds: Set<string>): { user: { id: string }; status: "online" }[] {
    const seen = new Set<string>();
    const presences: { user: { id: string }; status: "online" }[] = [];
    for (const session of this.sessions) {
      if (!session.user || seen.has(session.user.id)) continue;
      for (const gid of session.guildIds) {
        if (guildIds.has(gid)) {
          seen.add(session.user.id);
          presences.push({ user: { id: session.user.id }, status: "online" });
          break;
        }
      }
    }
    return presences;
  }

  threadCreate(thread: Channel): void {
    const guildId = thread.guild_id;
    if (thread.parent_id) {
      this.broadcastToGuildWithChannelFilter(guildId, thread.parent_id, "THREAD_CREATE", thread);
    }
  }

  threadUpdate(thread: Channel): void {
    const guildId = thread.guild_id;
    if (thread.parent_id) {
      this.broadcastToGuildWithChannelFilter(guildId, thread.parent_id, "THREAD_UPDATE", thread);
    }
  }

  threadDelete(thread: Channel): void {
    const guildId = thread.guild_id;
    if (thread.parent_id) {
      this.broadcastToGuildWithChannelFilter(guildId, thread.parent_id, "THREAD_DELETE", {
        id: thread.id, guild_id: guildId, parent_id: thread.parent_id, type: 11,
      });
    }
  }

  threadMemberUpdate(threadId: string, userId: string, guildId: string): void {
    this.sendToUser(userId, "THREAD_MEMBER_UPDATE", { id: threadId, user_id: userId });
  }

  threadMembersUpdate(threadId: string, guildId: string, addedMembers: string[], removedMembers: string[]): void {
    const thread = this.channelsRepo.getById(threadId);
    if (!thread?.parent_id) return;
    this.broadcastToGuildWithChannelFilter(guildId, thread.parent_id, "THREAD_MEMBERS_UPDATE", {
      id: threadId,
      guild_id: guildId,
      added_members: addedMembers.map((id) => ({ user_id: id })),
      removed_members: removedMembers.map((id) => ({ user_id: id })),
    });
  }

  channelFileCreate(channelId: string, file: { filename: string; content_type: string; size: number }): void {
    const guildId = this.resolveGuildForChannel(channelId);
    if (!guildId) return;
    this.broadcastToGuildWithChannelFilter(guildId, channelId, "CHANNEL_FILE_CREATE", {
      channel_id: channelId, guild_id: guildId, ...file
    });
  }

  channelFileUpdate(channelId: string, file: { filename: string; content_type: string; size: number }): void {
    const guildId = this.resolveGuildForChannel(channelId);
    if (!guildId) return;
    this.broadcastToGuildWithChannelFilter(guildId, channelId, "CHANNEL_FILE_UPDATE", {
      channel_id: channelId, guild_id: guildId, ...file
    });
  }

  channelFileDelete(channelId: string, filename: string): void {
    const guildId = this.resolveGuildForChannel(channelId);
    if (!guildId) return;
    this.broadcastToGuildWithChannelFilter(guildId, channelId, "CHANNEL_FILE_DELETE", {
      channel_id: channelId, guild_id: guildId, filename
    });
  }

  reactionAdd(channelId: string, messageId: string, userId: string, emoji: string, guildId: string, count: number): void {
    this.broadcastToGuildWithChannelFilter(guildId, channelId, "MESSAGE_REACTION_ADD", {
      user_id: userId,
      channel_id: channelId,
      message_id: messageId,
      guild_id: guildId,
      emoji: { id: null, name: emoji },
      count,
    });
  }

  reactionRemove(channelId: string, messageId: string, userId: string, emoji: string, guildId: string, count: number): void {
    this.broadcastToGuildWithChannelFilter(guildId, channelId, "MESSAGE_REACTION_REMOVE", {
      user_id: userId,
      channel_id: channelId,
      message_id: messageId,
      guild_id: guildId,
      emoji: { id: null, name: emoji },
      count,
    });
  }

  guildMemberUpdate(guildId: string, member: { user: { id: string }; nick: string | null; roles: string[]; joined_at: string }): void {
    this.broadcastToGuild(guildId, "GUILD_MEMBER_UPDATE", { ...member, guild_id: guildId });
  }

  guildRoleCreate(guildId: string, role: Role): void {
    this.broadcastToGuild(guildId, "GUILD_ROLE_CREATE", { guild_id: guildId, role });
  }

  guildRoleUpdate(guildId: string, role: Role): void {
    this.broadcastToGuild(guildId, "GUILD_ROLE_UPDATE", { guild_id: guildId, role });
  }

  guildRoleDelete(guildId: string, roleId: string): void {
    this.broadcastToGuild(guildId, "GUILD_ROLE_DELETE", { guild_id: guildId, role_id: roleId });
  }

  removeUser(userId: string): void {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds) return;
    const toRemove: GatewaySession[] = [];
    for (const sid of sessionIds) {
      const session = this.sessionsById.get(sid);
      if (session) toRemove.push(session);
    }
    for (const session of toRemove) {
      this.removeSession(session);
      session.close(4004, "User deleted");
    }
  }

  private broadcastToGuildMembers(userId: string, event: string, data: unknown, excludeSessionId?: string): void {
    const userGuildIds = this.getSessionGuildIds(userId);
    this.broadcastToGuilds(new Set(userGuildIds), event, data, excludeSessionId);
  }

  taskCreated(task: Task): void {
    const channel = this.channelsRepo.getById(task.channel_id);
    if (!channel) return;
    this.broadcastToGuildWithChannelFilter(channel.guild_id, task.channel_id, "TASK_CREATED", task);
  }

  taskUpdated(task: Task): void {
    const channel = this.channelsRepo.getById(task.channel_id);
    if (!channel) return;
    this.broadcastToGuildWithChannelFilter(channel.guild_id, task.channel_id, "TASK_UPDATED", task);
  }

  taskDeleted(task: Task): void {
    const channel = this.channelsRepo.getById(task.channel_id);
    if (!channel) return;
    this.broadcastToGuildWithChannelFilter(channel.guild_id, task.channel_id, "TASK_DELETED", task);
  }

  /** Broadcast to all sessions in any of the given guilds, deduplicating. */
  private broadcastToGuilds(guildIds: Set<string>, event: string, data: unknown, excludeSessionId?: string): void {
    for (const session of this.sessions) {
      if (excludeSessionId && session.id === excludeSessionId) continue;
      for (const gid of session.guildIds) {
        if (guildIds.has(gid)) {
          session.dispatch(event, data);
          break;
        }
      }
    }
  }
}
