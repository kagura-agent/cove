import type { Channel, Message, Bot, BotCreateResponse } from "../types";

const API_BASE = import.meta.env.VITE_COVE_API_URL ?? "";

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts?.headers as Record<string, string>),
    },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export function fetchChannels() {
  return api<Channel[]>("/api/v10/guilds/cove/channels");
}
export function fetchMessages(channelId: string) {
  return api<Message[]>(`/api/v10/channels/${channelId}/messages?limit=50`);
}
export function sendMessage(channelId: string, content: string, userId: string, username: string) {
  return api<Message>(`/api/v10/channels/${channelId}/messages`, {
    method: "POST", body: JSON.stringify({ content, userId, username }),
  });
}
export function editMessage(channelId: string, messageId: string, content: string) {
  return api<Message>(`/api/v10/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH", body: JSON.stringify({ content }),
  });
}
export function deleteMessage(channelId: string, messageId: string) {
  return api<void>(`/api/v10/channels/${channelId}/messages/${messageId}`, { method: "DELETE" });
}
export function clearMessages(channelId: string) {
  return api<void>(`/api/v10/channels/${channelId}/messages`, { method: "DELETE" });
}
export function createChannel(name: string, icon: string) {
  return api<Channel>("/api/v10/guilds/cove/channels", {
    method: "POST", body: JSON.stringify({ name, icon }),
  });
}
export function deleteChannel(channelId: string) {
  return api<void>(`/api/v10/channels/${channelId}`, { method: "DELETE" });
}
export function fetchBots() {
  return api<Bot[]>("/api/v10/guilds/cove/members");
}
export function createBot(username: string, emoji: string, bio: string) {
  return api<BotCreateResponse>("/api/v10/users", {
    method: "POST", body: JSON.stringify({ username, emoji, bio }),
  });
}
export function deleteBot(id: string) {
  return api<void>(`/api/v10/users/${id}`, { method: "DELETE" });
}
export function regenerateToken(id: string) {
  return api<{ token: string }>(`/api/v10/users/${id}/token`, { method: "POST" });
}
