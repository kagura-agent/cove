/**
 * Claude Code process manager.
 *
 * Spawns and manages `claude` CLI processes using stream-json I/O.
 * One process per channel, lazily created on first message.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";

/** Events emitted by a single Claude process. */
export interface ClaudeProcessEvents {
  /** Partial or complete assistant text. */
  text: (channelId: string, text: string) => void;
  /** Final result received — the response is complete. */
  result: (channelId: string, text: string) => void;
  /** The process exited (crash or clean). */
  exit: (channelId: string, code: number | null) => void;
  /** An error occurred. */
  error: (channelId: string, error: Error) => void;
}

type TypedEmitter<T> = {
  on<K extends keyof T>(event: K, listener: T[K]): TypedEmitter<T>;
  emit<K extends keyof T>(event: K, ...args: Parameters<T[K] & ((...args: any[]) => any)>): boolean;
} & EventEmitter;

interface ManagedProcess {
  proc: ChildProcess;
  sessionId: string;
}

/** Track the last completed session ID per channel for --resume. */
const channelSessions = new Map<string, string>();

export class ClaudeProcessManager extends (EventEmitter as new () => TypedEmitter<ClaudeProcessEvents>) {
  private readonly processes = new Map<string, ManagedProcess>();
  private readonly pendingMessages = new Map<string, string[]>();
  private readonly workingDir: string;

  constructor(workingDir: string) {
    super();
    this.workingDir = workingDir;
  }

  /**
   * Send a user message to the claude process for a channel.
   * Each message spawns a new claude process with --resume to maintain session.
   */
  sendMessage(channelId: string, content: string): void {
    let managed = this.processes.get(channelId);

    // If there's an active process, wait for it to finish
    if (managed && managed.proc.exitCode === null && !managed.proc.killed) {
      // Queue the message — it will be sent after the current process exits
      if (!this.pendingMessages.has(channelId)) {
        this.pendingMessages.set(channelId, []);
      }
      this.pendingMessages.get(channelId)!.push(content);
      return;
    }

    this.processes.delete(channelId);
    managed = this.spawnProcess(channelId, content);
  }

  /** Spawn a new claude process for a channel with a specific prompt. */
  private spawnProcess(channelId: string, prompt: string): ManagedProcess {
    const sessionId = randomUUID();
    const args = [
      "--print",
      "--verbose",
      "--output-format", "stream-json",
      "--dangerously-skip-permissions",
      "-p", prompt,
    ];

    const proc = spawn("claude", args, {
      cwd: this.workingDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    const managed: ManagedProcess = { proc, sessionId };
    this.processes.set(channelId, managed);

    // Parse stdout line by line for stream-json events
    const rl = createInterface({ input: proc.stdout! });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        this.handleStreamEvent(channelId, event);
      } catch {
        // Non-JSON output — ignore
      }
    });

    // Log stderr but don't crash
    const stderrRl = createInterface({ input: proc.stderr! });
    stderrRl.on("line", (line) => {
      if (line.trim()) {
        console.error(`[claude:${channelId.slice(0, 8)}] ${line}`);
      }
    });

    proc.on("exit", (code) => {
      this.processes.delete(channelId);
      // Save session ID for future --resume
      channelSessions.set(channelId, sessionId);
      this.emit("exit", channelId, code);
      // Process any pending messages for this channel
      const pending = this.pendingMessages.get(channelId);
      if (pending && pending.length > 0) {
        const nextMsg = pending.shift()!;
        if (pending.length === 0) this.pendingMessages.delete(channelId);
        // Small delay to let session ID release
        setTimeout(() => this.sendMessage(channelId, nextMsg), 500);
      }
    });

    proc.on("error", (err) => {
      this.processes.delete(channelId);
      this.emit("error", channelId, err);
    });

    console.log(`[claude] Spawned process for channel ${channelId} (session: ${sessionId.slice(0, 8)}...)`);
    return managed;
  }

  private handleStreamEvent(channelId: string, event: Record<string, unknown>): void {
    const type = event.type as string;

    switch (type) {
      case "assistant":
        if (typeof event.text === "string") {
          this.emit("text", channelId, event.text);
        }
        break;

      case "result":
        if (typeof event.result === "string") {
          this.emit("result", channelId, event.result);
        } else if (typeof event.text === "string") {
          this.emit("result", channelId, event.text);
        }
        break;

      // Ignore tool_use, thinking, system, etc. for MVP
      default:
        break;
    }
  }

  /** Kill all claude processes (for graceful shutdown). */
  destroyAll(): void {
    for (const [channelId, managed] of this.processes) {
      console.log(`[claude] Killing process for channel ${channelId}`);
      managed.proc.kill("SIGTERM");
    }
    this.processes.clear();
  }

  /** Check if a channel has an active process. */
  hasProcess(channelId: string): boolean {
    const managed = this.processes.get(channelId);
    return !!managed && managed.proc.exitCode === null && !managed.proc.killed;
  }
}

/**
 * Derive a deterministic UUID v4-format string from a channel ID.
 * This ensures the same channel always gets the same session ID
 * so Claude Code can resume conversations across bridge restarts.
 */
function deterministicUUID(input: string): string {
  // Simple hash → UUID format. Not cryptographic, just needs to be stable.
  let hash = 0n;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5n) - hash + BigInt(input.charCodeAt(i))) & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFn;
  }
  const hex = hash.toString(16).padStart(32, "0").slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    "4" + hex.slice(13, 16), // version 4
    ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20), // variant
    hex.slice(20, 32),
  ].join("-");
}
