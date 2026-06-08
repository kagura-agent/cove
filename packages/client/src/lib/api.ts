import type { Channel, Message, BotCreateResponse, GuildMember } from "../types";
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
export function fetchMessages(channelId: string) {
  return api<Message[]>(`${API_PREFIX}/channels/${channelId}/messages?limit=50`);
}
export function sendMessage(channelId: string, content: string, nonce?: string) {
  return api<Message>(`${API_PREFIX}/channels/${channelId}/messages`, {
    method: "POST", body: JSON.stringify(nonce ? { content, nonce } : { content }),
  });
}
export function clearMessages(channelId: string) {
  return api<void>(`${API_PREFIX}/channels/${channelId}/messages`, { method: "DELETE" });
}
export function createChannel(guildId: string, name: string, topic?: string) {
  return api<Channel>(`${API_PREFIX}/guilds/${guildId}/channels`, {
    method: "POST", body: JSON.stringify({ name, topic }),
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
    method: "POST", body: JSON.stringify({ username, bio }),
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
  return api<{ id: string; username: string; avatar: string | null; bot: boolean }>("/api/auth/me");
}

export function fetchPendingStatus() {
  return api<{ pending: boolean }>("/api/auth/pending-status");
}

export async function logout() {
  await api<{ message: string }>("/api/auth/logout", { method: "POST" });
}
