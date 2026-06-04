/**
 * Cove REST API client — public API, used by external consumers.
 *
 * Simple fetch wrapper that speaks the Discord-compatible Cove REST API.
 * All requests include the Bot token in the Authorization header.
 */

import type { Channel, Message } from "@cove/shared";
import { API_PREFIX } from "@cove/shared";

export class CoveRestClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Authorization": `Bot ${this.token}`,
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Cove API ${method} ${path} failed: ${res.status} ${text}`);
    }

    return res.json() as Promise<T>;
  }

  /** GET /api/v10/gateway — returns the Gateway WebSocket URL. */
  async getGatewayUrl(): Promise<string> {
    const data = await this.request<{ url: string }>("GET", `${API_PREFIX}/gateway`);
    return data.url;
  }

  /** GET /api/v10/users/@me — returns the authenticated bot user. */
  async getMe(): Promise<{ id: string; username: string; bot: boolean }> {
    return this.request("GET", `${API_PREFIX}/users/@me`);
  }

  /** GET /api/v10/guilds/:guildId/channels — list all channels. */
  async getChannels(guildId = "cove"): Promise<Channel[]> {
    return this.request("GET", `${API_PREFIX}/guilds/${guildId}/channels`);
  }

  /** GET /api/v10/channels/:id — single channel detail. */
  async getChannel(id: string): Promise<Channel> {
    return this.request("GET", `${API_PREFIX}/channels/${id}`);
  }

  /** POST /api/v10/channels/:id/messages — send a message. */
  async sendMessage(channelId: string, content: string): Promise<Message> {
    return this.request("POST", `${API_PREFIX}/channels/${channelId}/messages`, {
      content,
    });
  }

  /** PATCH /api/v10/channels/:id/messages/:msgId — edit a message. */
  async editMessage(channelId: string, messageId: string, content: string): Promise<Message> {
    return this.request("PATCH", `${API_PREFIX}/channels/${channelId}/messages/${messageId}`, {
      content,
    });
  }

  /** GET /api/v10/channels/:id/messages — fetch recent messages. */
  async getMessages(channelId: string, limit = 50): Promise<Message[]> {
    return this.request("GET", `${API_PREFIX}/channels/${channelId}/messages?limit=${limit}`);
  }

  /** DELETE /api/v10/channels/:id/messages/:msgId — delete a message. */
  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    const url = `${this.baseUrl}${API_PREFIX}/channels/${channelId}/messages/${messageId}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { "Authorization": `Bot ${this.token}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Cove API DELETE /channels/${channelId}/messages/${messageId} failed: ${res.status} ${text}`);
    }
  }

  /** POST /api/v10/channels/:id/typing — send typing indicator. */
  async sendTyping(channelId: string): Promise<void> {
    const url = `${this.baseUrl}${API_PREFIX}/channels/${channelId}/typing`;
    await fetch(url, {
      method: "POST",
      headers: { "Authorization": `Bot ${this.token}` },
    });
  }
}
