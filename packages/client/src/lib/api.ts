import type { Channel, Message, BotCreateResponse, GuildMember } from "../types";
import { API_PREFIX } from "@cove/shared";

const API_BASE = import.meta.env.VITE_COVE_API_URL ?? "";

let _guildId: string | null = null;

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

/** Fetch the user's first guild ID (cached after first call) */
export async function getGuildId(): Promise<string> {
  if (_guildId) return _guildId;
  const guilds = await api<Array<{ id: string }>>(`${API_PREFIX}/users/@me/guilds`);
  if (!guilds.length) throw new Error("No guilds available");
  _guildId = guilds[0].id;
  return _guildId;
}

/** Reset cached guild ID (call on logout) */
export function resetGuildId(): void {
  _guildId = null;
}

/** Set the cached guild ID from READY payload (avoids REST call) */
export function setGuildId(id: string): void {
  _guildId = id;
}

/** @deprecated Channels are now seeded from the READY gateway event. Use for manual refresh only. */
export async function fetchChannels() {
  const guildId = await getGuildId();
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
export async function createChannel(name: string, topic?: string) {
  const guildId = await getGuildId();
  return api<Channel>(`${API_PREFIX}/guilds/${guildId}/channels`, {
    method: "POST", body: JSON.stringify({ name, topic }),
  });
}
export function deleteChannel(channelId: string) {
  return api<void>(`${API_PREFIX}/channels/${channelId}`, { method: "DELETE" });
}
export async function fetchMembers() {
  const guildId = await getGuildId();
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
export function fetchMe() {
  return api<{ id: string; username: string; avatar: string | null; bot: boolean }>("/api/auth/me");
}

export function fetchPendingStatus() {
  return api<{ pending: boolean }>("/api/auth/pending-status");
}

export async function logout() {
  await api<{ message: string }>("/api/auth/logout", { method: "POST" });

}
