/**
 * Cove REST API client.
 *
 * Simple fetch wrapper that speaks the Discord-compatible Cove REST API.
 * All requests include the Bot token in the Authorization header.
 */

import type { DiscordChannel, DiscordMessage } from "@cove/shared";

export class CoveRestClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly defaultAgentId: string;
  private readonly defaultAgentName: string;

  constructor(baseUrl: string, token: string, agentId?: string, agentName?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
    this.defaultAgentId = agentId ?? "";
    this.defaultAgentName = agentName ?? "";
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
    const data = await this.request<{ url: string }>("GET", "/api/v10/gateway");
    return data.url;
  }

  /** GET /api/v10/users/@me — returns the authenticated bot user. */
  async getMe(): Promise<{ id: string; username: string; bot: boolean }> {
    return this.request("GET", "/api/v10/users/@me");
  }

  /** GET /api/v10/guilds/:guildId/channels — list all channels. */
  async getChannels(guildId = "cove"): Promise<DiscordChannel[]> {
    return this.request("GET", `/api/v10/guilds/${guildId}/channels`);
  }

  /** GET /api/v10/channels/:id — single channel detail. */
  async getChannel(id: string): Promise<DiscordChannel> {
    return this.request("GET", `/api/v10/channels/${id}`);
  }

  /** POST /api/v10/channels/:id/messages — send a message. */
  async sendMessage(channelId: string, content: string, author?: { userId: string; username: string }): Promise<DiscordMessage> {
    const resolvedAuthor = author ?? {
      userId: this.defaultAgentId || process.env["COVE_AGENT_ID"] || "",
      username: this.defaultAgentName || process.env["COVE_AGENT_NAME"] || "",
    };
    if (!resolvedAuthor.userId) {
      throw new Error("Cove: agent ID is required — set COVE_AGENT_ID env or pass agentId to CoveRestClient");
    }
    return this.request("POST", `/api/v10/channels/${channelId}/messages`, {
      content,
      ...resolvedAuthor,
    });
  }

  /** GET /api/v10/channels/:id/messages — fetch recent messages. */
  async getMessages(channelId: string, limit = 50): Promise<DiscordMessage[]> {
    return this.request("GET", `/api/v10/channels/${channelId}/messages?limit=${limit}`);
  }
}
