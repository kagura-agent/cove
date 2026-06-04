import type { Channel, Message, BotCreateResponse, GuildMember } from "../types";
import { API_PREFIX } from "@cove/shared";

const API_BASE = import.meta.env.VITE_COVE_API_URL ?? "";

function getToken(): string | null {
  return localStorage.getItem("cove-token");
}

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts?.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function fetchChannels() {
  return api<Channel[]>(`${API_PREFIX}/guilds/cove/channels`);
}
export function fetchMessages(channelId: string) {
  return api<Message[]>(`${API_PREFIX}/channels/${channelId}/messages?limit=50`);
}
export function sendMessage(channelId: string, content: string) {
  return api<Message>(`${API_PREFIX}/channels/${channelId}/messages`, {
    method: "POST", body: JSON.stringify({ content }),
  });
}
export function clearMessages(channelId: string) {
  return api<void>(`${API_PREFIX}/channels/${channelId}/messages`, { method: "DELETE" });
}
export function createChannel(name: string, topic?: string) {
  return api<Channel>(`${API_PREFIX}/guilds/cove/channels`, {
    method: "POST", body: JSON.stringify({ name, topic }),
  });
}
export function deleteChannel(channelId: string) {
  return api<void>(`${API_PREFIX}/channels/${channelId}`, { method: "DELETE" });
}
export function fetchMembers() {
  return api<GuildMember[]>(`${API_PREFIX}/guilds/cove/members`);
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
export function fetchMe() {
  return api<{ id: string; username: string; avatar: string | null; bot: boolean }>("/api/auth/me");
}
