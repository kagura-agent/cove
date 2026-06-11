/**
 * Bridge — main orchestration module.
 *
 * Connects gateway events to Claude processes and sends responses
 * back to Cove channels via the REST API.
 */

import { GatewayClient } from "./gateway-client.js";
import { RestClient } from "./rest-client.js";
import { ClaudeProcessManager } from "./claude-process.js";

/** Discord message content length limit. */
const MAX_MESSAGE_LENGTH = 2000;

/** How often to send typing indicators while Claude is processing. */
const TYPING_INTERVAL_MS = 5_000;

export interface BridgeConfig {
  /** Cove base URL (e.g. https://staging.cove.kagura-agent.com) */
  baseUrl: string;
  /** Bot token */
  token: string;
  /** Guild ID to scope message handling */
  guildId: string;
  /** Working directory for Claude processes */
  workingDir: string;
}

export class Bridge {
  private readonly rest: RestClient;
  private readonly claude: ClaudeProcessManager;
  private readonly guildId: string;
  private readonly baseUrl: string;
  private readonly token: string;
  private gateway!: GatewayClient;

  /** Track the current response message per channel for streaming edits. */
  private activeResponses = new Map<string, {
    messageId: string;
    content: string;
    /** Whether the final result has arrived (waiting for messageId). */
    resultPending: string | null;
  }>();

  /** Typing indicator intervals per channel. */
  private typingIntervals = new Map<string, ReturnType<typeof setInterval>>();

  /** Debounce timers for batching edits. */
  private editTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(config: BridgeConfig) {
    this.guildId = config.guildId;
    this.baseUrl = config.baseUrl;
    this.token = config.token;

    this.rest = new RestClient(config.baseUrl, config.token);
    this.claude = new ClaudeProcessManager(config.workingDir);

    this.setupClaudeHandlers();
  }

  async start(): Promise<void> {
    console.log("[bridge] Starting...");

    // Discover gateway URL from REST API, fall back to derived URL
    let wsUrl: string;
    try {
      wsUrl = await this.rest.getGatewayUrl();
      console.log(`[bridge] Gateway URL from API: ${wsUrl}`);
    } catch {
      wsUrl = this.baseUrl.replace(/^http/, "ws") + "/gateway";
      console.log(`[bridge] Could not fetch gateway URL from REST, using derived URL: ${wsUrl}`);
    }

    this.gateway = new GatewayClient({ url: wsUrl, token: this.token });
    this.setupGatewayHandlers();
    this.gateway.connect();
  }

  shutdown(): void {
    console.log("[bridge] Shutting down...");
    this.gateway?.destroy();
    this.claude.destroyAll();
    for (const timer of this.typingIntervals.values()) clearInterval(timer);
    this.typingIntervals.clear();
    for (const timer of this.editTimers.values()) clearTimeout(timer);
    this.editTimers.clear();
  }

  private setupGatewayHandlers(): void {
    this.gateway.on("ready", (user) => {
      console.log(`[bridge] Connected as ${user.username} (${user.id})`);
    });

    this.gateway.on("messageCreate", (message) => {
      // Ignore bot messages (prevent echo loops)
      if (message.author.bot) return;

      // Only handle messages from our guild
      if ((message as any).guild_id && (message as any).guild_id !== this.guildId) return;

      // Only handle messages (ignore empty)
      if (!message.content?.trim()) return;

      console.log(`[bridge] Message from ${message.author.username} in ${message.channel_id}: ${message.content.slice(0, 80)}`);

      this.handleUserMessage(message.channel_id, message.author.username, message.content);
    });

    this.gateway.on("close", () => {
      console.log("[bridge] Gateway disconnected, will reconnect...");
    });

    this.gateway.on("reconnect", () => {
      console.log("[bridge] Gateway reconnected");
    });

    this.gateway.on("error", (err) => {
      console.error("[bridge] Gateway error:", err.message);
    });
  }

  private setupClaudeHandlers(): void {
    this.claude.on("text", (channelId, text) => {
      this.handleClaudeText(channelId, text);
    });

    this.claude.on("result", (channelId, text) => {
      this.handleClaudeResult(channelId, text);
    });

    this.claude.on("exit", (channelId, code) => {
      console.log(`[bridge] Claude process for ${channelId} exited with code ${code}`);
      this.stopTyping(channelId);
      // Non-zero exit with no response sent — notify user
      if (code !== 0 && code !== null && !this.activeResponses.has(channelId)) {
        this.rest.sendMessage(channelId, `⚠️ Claude exited with an error (code ${code}).`).catch(() => {});
      }
    });

    this.claude.on("error", (channelId, error) => {
      console.error(`[bridge] Claude process error for ${channelId}:`, error.message);
      this.stopTyping(channelId);
      this.rest.sendMessage(channelId, "⚠️ Claude process encountered an error.").catch(() => {});
    });
  }

  private handleUserMessage(channelId: string, username: string, content: string): void {
    // Start typing indicator
    this.startTyping(channelId);

    // Only clear previous response if no active process (avoids corrupting in-flight response)
    if (!this.claude.hasProcess(channelId)) {
      this.activeResponses.delete(channelId);
    }

    // Forward to Claude — include username for context
    const messageForClaude = `[${username}]: ${content}`;
    this.claude.sendMessage(channelId, messageForClaude);
  }

  private handleClaudeText(channelId: string, text: string): void {
    const active = this.activeResponses.get(channelId);

    if (!active) {
      // First text chunk — send a new message
      this.activeResponses.set(channelId, {
        messageId: "", // Will be set after sendMessage completes
        content: text,
        resultPending: null,
      });

      this.rest.sendMessage(channelId, text).then((msg) => {
        const current = this.activeResponses.get(channelId);
        if (current) {
          current.messageId = msg.id;
          // If result arrived while we were sending, do the final edit now
          if (current.resultPending !== null) {
            this.editMessageSafe(channelId, msg.id, current.resultPending);
            this.activeResponses.delete(channelId);
          } else if (current.content !== text) {
            // Content grew since we sent — schedule an edit
            this.scheduleEdit(channelId);
          }
        }
      }).catch((err) => {
        console.error(`[bridge] Failed to send message to ${channelId}:`, err.message);
      });
    } else {
      // Subsequent text — accumulate and debounce-edit
      active.content = text;
      if (active.messageId) {
        this.scheduleEdit(channelId);
      }
    }
  }

  private handleClaudeResult(channelId: string, resultText: string): void {
    this.stopTyping(channelId);

    // Cancel any pending edit
    const editTimer = this.editTimers.get(channelId);
    if (editTimer) {
      clearTimeout(editTimer);
      this.editTimers.delete(channelId);
    }

    const active = this.activeResponses.get(channelId);

    if (active && active.messageId) {
      // Edit the existing message with the final result
      this.editMessageSafe(channelId, active.messageId, resultText);
      this.activeResponses.delete(channelId);
    } else if (active && !active.messageId) {
      // messageId not yet set — mark result as pending so sendMessage callback handles it
      active.resultPending = resultText;
      // Don't delete activeResponses here — the sendMessage callback will
    } else {
      // No streaming text was received — send the result directly
      this.rest.sendMessage(channelId, resultText || "(empty response)").catch((err) => {
        console.error(`[bridge] Failed to send result to ${channelId}:`, err.message);
      });
    }
  }

  /**
   * Schedule a debounced edit to avoid flooding the API with rapid updates.
   * Batches updates within a 300ms window.
   */
  private scheduleEdit(channelId: string): void {
    if (this.editTimers.has(channelId)) return; // already scheduled

    this.editTimers.set(channelId, setTimeout(() => {
      this.editTimers.delete(channelId);
      const active = this.activeResponses.get(channelId);
      if (active && active.messageId) {
        this.editMessageSafe(channelId, active.messageId, active.content);
      }
    }, 300));
  }

  /** Edit a message, truncating if content exceeds the limit. */
  private editMessageSafe(channelId: string, messageId: string, content: string): void {
    const truncated = content.length > MAX_MESSAGE_LENGTH
      ? content.slice(0, MAX_MESSAGE_LENGTH - 20) + "\n\n…(truncated)"
      : content;

    this.rest.editMessage(channelId, messageId, truncated || "(empty)").catch((err) => {
      console.error(`[bridge] Failed to edit message in ${channelId}:`, err.message);
    });
  }

  private startTyping(channelId: string): void {
    // Send immediately and then every TYPING_INTERVAL_MS
    this.rest.sendTyping(channelId).catch(() => {});

    if (!this.typingIntervals.has(channelId)) {
      const interval = setInterval(() => {
        this.rest.sendTyping(channelId).catch(() => {});
      }, TYPING_INTERVAL_MS);
      this.typingIntervals.set(channelId, interval);
    }
  }

  private stopTyping(channelId: string): void {
    const interval = this.typingIntervals.get(channelId);
    if (interval) {
      clearInterval(interval);
      this.typingIntervals.delete(channelId);
    }
  }
}
