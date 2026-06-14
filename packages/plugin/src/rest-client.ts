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

export class CoveApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "CoveApiError";
  }
}

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

    const isIdempotent = method === "GET" || method === "DELETE" || method === "HEAD" || method === "PUT";

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });

        // 429: server explicitly rejected without processing — safe to retry all methods
        if (res.status === 429) {
          const raw = res.headers.get("Retry-After");
          const delay = Math.min(parseFloat(raw ?? "") || 1, 30) * 1000;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        // 5xx: only retry idempotent methods (POST/PATCH may have committed server-side)
        if (res.status >= 500) {
          lastError = new Error(`Cove API ${method} ${path} failed: ${res.status}`);
          if (isIdempotent && attempt < MAX_RETRIES) {
            const backoff = Math.min(1000 * Math.pow(2, attempt), 10_000) + Math.random() * 500;
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
          throw lastError;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new CoveApiError(res.status, `Cove API ${method} ${path} failed: ${res.status} ${text}`);
        }

        if (res.status === 204) return undefined as unknown as T;
        return res.json() as Promise<T>;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        // Network errors: only retry idempotent methods (non-idempotent may have been received)
        if (isIdempotent && attempt < MAX_RETRIES) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 10_000) + Math.random() * 500;
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        throw lastError;
      }
    }

    throw lastError ?? new Error(`Cove API ${method} ${path} failed after retries`);
  }

  /** Fire-and-forget request that does not parse the response body. */
  private async requestVoid(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<void> {
    await this.request<unknown>(method, path, body, signal);
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

  /** GET /api/v10/users/:id — returns a user by ID. */
  async getUser(id: string): Promise<{ id: string; username: string; bot?: boolean }> {
    return this.request("GET", `${API_PREFIX}/users/${id}`);
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

  /** GET /api/v10/channels/:channelId/messages/:messageId — get a single message. */
  async getMessage(channelId: string, messageId: string): Promise<Message> {
    return this.request("GET", `${API_PREFIX}/channels/${channelId}/messages/${messageId}`);
  }

  /** POST /api/v10/channels/:id/typing — send typing indicator. */
  async sendTyping(channelId: string): Promise<void> {
    return this.requestVoid("POST", `${API_PREFIX}/channels/${channelId}/typing`, undefined, AbortSignal.timeout(3000));
  }

  /** POST /api/v10/channels/:channelId/webhooks — create a webhook. */
  async createWebhook(channelId: string, name: string, avatar?: string): Promise<{ id: string; token: string; channel_id: string; name: string }> {
    return this.request("POST", `${API_PREFIX}/channels/${channelId}/webhooks`, {
      name,
      ...(avatar ? { avatar } : {}),
    });
  }

  /** GET /api/v10/channels/:channelId/webhooks — list channel webhooks. */
  async getWebhooks(channelId: string): Promise<Array<{ id: string; token?: string; channel_id: string; name: string }>> {
    return this.request("GET", `${API_PREFIX}/channels/${channelId}/webhooks`);
  }

  /** POST /api/v10/webhooks/:id/:token — execute webhook (no auth needed).
   * Sends a message to the webhook's channel with the webhook's identity.
   * Use `username` to override display name (e.g. "From #home").
   */
  async executeWebhook(webhookId: string, webhookToken: string, content: string, username?: string, avatarUrl?: string): Promise<Message> {
    return this.request("POST", `${API_PREFIX}/webhooks/${webhookId}/${webhookToken}`, {
      content,
      ...(username ? { username } : {}),
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
    });
  }

  /** GET /api/v10/channels/:channelId/files/:filename — get a channel file. */
  async getChannelFile(channelId: string, filename: string): Promise<{ content: string; filename: string; size: number } | null> {
    try {
      return await this.request("GET", `${API_PREFIX}/channels/${channelId}/files/${encodeURIComponent(filename)}`);
    } catch (err) {
      // 404 (not found) and 403 (no permission) are expected — return null
      if (err instanceof CoveApiError && (err.status === 404 || err.status === 403)) return null;
      throw err;
    }
  }
}
