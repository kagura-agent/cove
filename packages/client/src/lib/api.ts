import type { Channel, Message, BotCreateResponse, GuildMember } from "../types";
import type { Webhook } from "@cove/shared";
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
export function clearMessages(channelId: string) {
  return api<void>(`${API_PREFIX}/channels/${channelId}/messages`, { method: "DELETE" });
}
export function deleteMessage(channelId: string, messageId: string) {
  return api<void>(`${API_PREFIX}/channels/${channelId}/messages/${messageId}`, { method: "DELETE" });
}
export function createChannel(guildId: string, name: string, topic?: string) {
  return api<Channel>(`${API_PREFIX}/guilds/${guildId}/channels`, {
    method: "POST", body: JSON.stringify({ name, topic }),
  });
}
export function updateChannel(channelId: string, data: { name?: string; topic?: string }) {
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
