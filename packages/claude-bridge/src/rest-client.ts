/**
 * Cove REST API client for the Claude bridge.
 *
 * Simplified version of packages/plugin/src/rest-client.ts.
 * Provides sendMessage, editMessage, and sendTyping.
 */

import { API_PREFIX } from "@cove/shared";
import type { Message } from "@cove/shared";

const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30_000;

export class RestClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bot ${this.token}`,
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
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });

        if (res.status === 429) {
          const raw = res.headers.get("Retry-After");
          const delay = Math.min(parseFloat(raw ?? "") || 1, 30) * 1000;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        if (res.status >= 500) {
          lastError = new Error(`Cove API ${method} ${path}: ${res.status}`);
          if (isIdempotent && attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
            continue;
          }
          throw lastError;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Cove API ${method} ${path}: ${res.status} ${text}`);
        }

        if (res.status === 204) return undefined as unknown as T;
        return (await res.json()) as T;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        if (isIdempotent && attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
          continue;
        }
        throw lastError;
      }
    }

    throw lastError ?? new Error(`Cove API ${method} ${path} failed after retries`);
  }

  /** GET /api/v10/gateway — returns the Gateway WebSocket URL. */
  async getGatewayUrl(): Promise<string> {
    const data = await this.request<{ url: string }>("GET", `${API_PREFIX}/gateway`);
    return data.url;
  }

  /** POST /api/v10/channels/:id/messages */
  async sendMessage(channelId: string, content: string): Promise<Message> {
    return this.request("POST", `${API_PREFIX}/channels/${channelId}/messages`, { content });
  }

  /** PATCH /api/v10/channels/:id/messages/:msgId */
  async editMessage(channelId: string, messageId: string, content: string): Promise<Message> {
    return this.request("PATCH", `${API_PREFIX}/channels/${channelId}/messages/${messageId}`, { content });
  }

  /** POST /api/v10/channels/:id/typing */
  async sendTyping(channelId: string): Promise<void> {
    await this.request("POST", `${API_PREFIX}/channels/${channelId}/typing`);
  }
}
