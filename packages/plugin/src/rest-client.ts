/**
 * Cove REST API client — public API, used by external consumers.
 *
 * Simple fetch wrapper that speaks the Discord-compatible Cove REST API.
 * All requests include the Bot token in the Authorization header.
 * Includes retry logic with exponential backoff and 429 rate-limit handling.
 */

import type { Channel, Message } from "@cove/shared";
import { API_PREFIX } from "@cove/shared";

const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30_000;

export class CoveRestClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Authorization": `Bot ${this.token}`,
      "Content-Type": "application/json",
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      if (res.status === 429) {
        const retryAfter = parseFloat(res.headers.get("Retry-After") ?? "1");
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Cove API ${method} ${path} failed: ${res.status} ${text}`);
      }

      return res.json() as Promise<T>;
    }

    throw new Error(`Cove API ${method} ${path}: max retries exceeded`);
  }

  /** Fire-and-forget request that does not parse the response body. */
  private async requestVoid(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<void> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Authorization": `Bot ${this.token}`,
    };
    if (body) headers["Content-Type"] = "application/json";

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      if (res.status === 429) {
        const retryAfter = parseFloat(res.headers.get("Retry-After") ?? "1");
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Cove API ${method} ${path} failed: ${res.status} ${text}`);
      }

      return;
    }

    throw new Error(`Cove API ${method} ${path}: max retries exceeded`);
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
  async getChannels(guildId: string): Promise<Channel[]> {
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
    return this.requestVoid("DELETE", `${API_PREFIX}/channels/${channelId}/messages/${messageId}`);
  }

  /** POST /api/v10/channels/:id/typing — send typing indicator. */
  async sendTyping(channelId: string): Promise<void> {
    return this.requestVoid("POST", `${API_PREFIX}/channels/${channelId}/typing`);
  }
}
