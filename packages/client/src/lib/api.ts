import type { Channel, Message, BotCreateResponse, GuildMember } from "../types";
import type { Role, Webhook } from "@cove/shared";
import { API_PREFIX } from "@cove/shared";

const API_BASE = import.meta.env.VITE_COVE_API_URL ?? "";

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts?.headers as Record<string, string>),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
    credentials: "include",
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** @deprecated Channels are now seeded from the READY gateway event. Use for manual refresh only. */
export function fetchChannels(guildId: string) {
  return api<Channel[]>(`${API_PREFIX}/guilds/${guildId}/channels`);
}
export function fetchMessages(channelId: string, opts?: { before?: string; limit?: number }) {
  const limit = opts?.limit ?? 50;
  const params = new URLSearchParams({ limit: String(limit) });
  if (opts?.before) params.set("before", opts.before);
  return api<Message[]>(`${API_PREFIX}/channels/${channelId}/messages?${params}`);
}
export function sendMessage(channelId: string, content: string, nonce?: string, messageReference?: { message_id: string }) {
  const body: Record<string, unknown> = { content };
  if (nonce) body.nonce = nonce;
  if (messageReference) body.message_reference = messageReference;
  return api<Message>(`${API_PREFIX}/channels/${channelId}/messages`, {
    method: "POST", body: JSON.stringify(body),
  });
}

export async function sendMessageWithAttachments(
  channelId: string,
  content: string,
  files: File[],
  nonce?: string,
  messageReference?: { message_id: string },
) {
  const formData = new FormData();
  const payload: Record<string, unknown> = { content };
  if (nonce) payload.nonce = nonce;
  if (messageReference) payload.message_reference = messageReference;
  formData.append('payload_json', JSON.stringify(payload));
  files.forEach((file, i) => {
    formData.append('files[' + i + ']', file, file.name);
  });
  // Use fetch directly since our api() helper sets Content-Type to JSON
  const token = sessionStorage.getItem('token') || localStorage.getItem('token') || '';
  const res = await fetch(API_BASE + API_PREFIX + '/channels/' + channelId + '/messages', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    credentials: 'include',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Upload failed');
  }
  return res.json() as Promise<Message>;
}
export function clearMessages(channelId: string) {
  return api<void>(`${API_PREFIX}/channels/${channelId}/messages`, { method: "DELETE" });
}
export function deleteMessage(channelId: string, messageId: string) {
  return api<void>(`${API_PREFIX}/channels/${channelId}/messages/${messageId}`, { method: "DELETE" });
}
export function editMessage(channelId: string, messageId: string, content: string) {
  return api<Message>(`${API_PREFIX}/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH", body: JSON.stringify({ content }),
  });
}
export function createChannel(guildId: string, name: string, topic?: string) {
  return api<Channel>(`${API_PREFIX}/guilds/${guildId}/channels`, {
    method: "POST", body: JSON.stringify({ name, topic }),
  });
}
export function updateChannel(channelId: string, data: { name?: string; topic?: string; archived?: boolean }) {
  return api<Channel>(`${API_PREFIX}/channels/${channelId}`, {
    method: "PATCH", body: JSON.stringify(data),
  });
}
export function deleteChannel(channelId: string) {
  return api<void>(`${API_PREFIX}/channels/${channelId}`, { method: "DELETE" });
}
export function fetchMembers(guildId: string) {
  return api<GuildMember[]>(`${API_PREFIX}/guilds/${guildId}/members`);
}
export function createBot(username: string, bio: string) {
  return api<BotCreateResponse>(`${API_PREFIX}/users`, {
    method: "POST", body: JSON.stringify({ username, bio, bot: true }),
  });
}
export function deleteBot(id: string) {
  return api<void>(`${API_PREFIX}/users/${id}`, { method: "DELETE" });
}
export function sendTyping(channelId: string) {
  return api<void>(`${API_PREFIX}/channels/${channelId}/typing`, { method: "POST" });
}
export function ackMessage(channelId: string, messageId: string) {
  return api<void>(`${API_PREFIX}/channels/${channelId}/messages/${messageId}/ack`, { method: "PUT" });
}
export function addReaction(channelId: string, messageId: string, emoji: string) {
  return api<void>(`${API_PREFIX}/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, { method: "PUT" });
}
export function removeReaction(channelId: string, messageId: string, emoji: string) {
  return api<void>(`${API_PREFIX}/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, { method: "DELETE" });
}
export function fetchMe() {
  return api<{ id: string; username: string; avatar: string | null; bot: boolean; global_name?: string | null }>("/api/auth/me");
}

export function updateMe(fields: { global_name?: string | null }) {
  return api<{ id: string; username: string; avatar: string | null; global_name: string | null }>(
    `${API_PREFIX}/users/@me`,
    { method: "PATCH", body: JSON.stringify(fields) },
  );
}

export function fetchPendingStatus() {
  return api<{ pending: boolean }>("/api/auth/pending-status");
}

export async function logout() {
  await api<{ message: string }>("/api/auth/logout", { method: "POST" });
}

export function fetchWebhooks(channelId: string) {
  return api<Webhook[]>(`${API_PREFIX}/channels/${channelId}/webhooks`);
}
export function createWebhook(channelId: string, name: string) {
  return api<Webhook>(`${API_PREFIX}/channels/${channelId}/webhooks`, {
    method: "POST", body: JSON.stringify({ name }),
  });
}
export function deleteWebhook(webhookId: string) {
  return api<void>(`${API_PREFIX}/webhooks/${webhookId}`, { method: "DELETE" });
}
export function putPermissionOverwrite(channelId: string, targetId: string, data: { type: number; allow: string; deny: string }) {
  return api<void>(`${API_PREFIX}/channels/${channelId}/permissions/${targetId}`, {
    method: "PUT", body: JSON.stringify(data),
  });
}
export function deletePermissionOverwrite(channelId: string, targetId: string) {
  return api<void>(`${API_PREFIX}/channels/${channelId}/permissions/${targetId}`, { method: "DELETE" });
}

// ─── Channel Files ────────────────────────────────────────────────────

export interface ChannelFileMeta {
  channel_id: string;
  filename: string;
  content_type: string;
  size: number;
  created_at: number;
  updated_at: number;
}

export interface ChannelFile extends ChannelFileMeta {
  content: string;
}

export function getChannelFiles(channelId: string) {
  return api<ChannelFileMeta[]>(`${API_PREFIX}/channels/${channelId}/files`);
}
export function getChannelFile(channelId: string, filename: string) {
  return api<ChannelFile>(`${API_PREFIX}/channels/${channelId}/files/${encodeURIComponent(filename)}`);
}
export function putChannelFile(channelId: string, filename: string, content: string, contentType?: string) {
  return api<ChannelFile>(`${API_PREFIX}/channels/${channelId}/files/${encodeURIComponent(filename)}`, {
    method: "PUT",
    body: JSON.stringify({ content, ...(contentType ? { content_type: contentType } : {}) }),
  });
}
export function deleteChannelFile(channelId: string, filename: string) {
  return api<void>(`${API_PREFIX}/channels/${channelId}/files/${encodeURIComponent(filename)}`, { method: "DELETE" });
}

// ─── Single Channel / Message ───────────────────────────────────────

export function fetchChannel(channelId: string) {
  return api<Channel>(`${API_PREFIX}/channels/${channelId}`);
}

export function fetchMessage(channelId: string, messageId: string) {
  return api<Message>(`${API_PREFIX}/channels/${channelId}/messages/${messageId}`);
}

// ─── Threads ──────────────────────────────────────────────────────────

export function createThreadFromMessage(channelId: string, messageId: string, name: string) {
  return api<Channel>(`${API_PREFIX}/channels/${channelId}/messages/${messageId}/threads`, {
    method: "POST", body: JSON.stringify({ name }),
  });
}

export function createThread(channelId: string, name: string) {
  return api<Channel>(`${API_PREFIX}/channels/${channelId}/threads`, {
    method: "POST", body: JSON.stringify({ name }),
  });
}

export function fetchActiveThreads(channelId: string) {
  return api<{ threads: Channel[]; has_more: boolean }>(`${API_PREFIX}/channels/${channelId}/threads/active`);
}

export function fetchArchivedThreads(channelId: string) {
  return api<{ threads: Channel[]; has_more: boolean }>(`${API_PREFIX}/channels/${channelId}/threads/archived/public`);
}

export function fetchGuildActiveThreads(guildId: string) {
  return api<{ threads: Channel[]; has_more: boolean }>(`${API_PREFIX}/guilds/${guildId}/threads/active`);
}

export function joinThread(threadId: string) {
  return api<void>(`${API_PREFIX}/channels/${threadId}/thread-members/@me`, { method: "PUT" });
}

export function leaveThread(threadId: string) {
  return api<void>(`${API_PREFIX}/channels/${threadId}/thread-members/@me`, { method: "DELETE" });
}

export function fetchThreadMessages(threadId: string, opts?: { before?: string; limit?: number }) {
  return fetchMessages(threadId, opts); // threads are channels, same endpoint
}

export function sendThreadMessage(threadId: string, content: string, nonce?: string) {
  return sendMessage(threadId, content, nonce);
}

// ─── Roles ───────────────────────────────────────────────────────────

export function fetchRoles(guildId: string) {
  return api<Role[]>(`${API_PREFIX}/guilds/${guildId}/roles`);
}
export function createRole(guildId: string, data?: Partial<Pick<Role, "name" | "color" | "hoist" | "mentionable" | "permissions">>) {
  return api<Role>(`${API_PREFIX}/guilds/${guildId}/roles`, {
    method: "POST", body: JSON.stringify(data ?? {}),
  });
}
export function updateRole(guildId: string, roleId: string, data: Partial<Pick<Role, "name" | "color" | "hoist" | "mentionable" | "permissions">>) {
  return api<Role>(`${API_PREFIX}/guilds/${guildId}/roles/${roleId}`, {
    method: "PATCH", body: JSON.stringify(data),
  });
}
export function deleteRole(guildId: string, roleId: string) {
  return api<void>(`${API_PREFIX}/guilds/${guildId}/roles/${roleId}`, { method: "DELETE" });
}
export function updateRolePositions(guildId: string, positions: Array<{ id: string; position: number }>) {
  return api<Role[]>(`${API_PREFIX}/guilds/${guildId}/roles`, {
    method: "PATCH", body: JSON.stringify(positions),
  });
}
export function addMemberRole(guildId: string, userId: string, roleId: string) {
  return api<void>(`${API_PREFIX}/guilds/${guildId}/members/${userId}/roles/${roleId}`, { method: "PUT" });
}
export function removeMemberRole(guildId: string, userId: string, roleId: string) {
  return api<void>(`${API_PREFIX}/guilds/${guildId}/members/${userId}/roles/${roleId}`, { method: "DELETE" });
}
