/**
 * Claude Code process manager.
 *
 * Spawns and manages `claude` CLI processes using stream-json I/O.
 * One process per message, with message queuing per channel.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";

/** Events emitted by the process manager. */
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

/** Minimal env vars to pass to Claude child processes. */
const ALLOWED_ENV_KEYS = ["PATH", "HOME", "USER", "SHELL", "LANG", "TERM", "NODE_ENV", "ANTHROPIC_API_KEY", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"];

function sanitizedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ALLOWED_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return env;
}

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
   * Each message spawns a new claude process.
   */
  sendMessage(channelId: string, content: string): void {
    const managed = this.processes.get(channelId);

    // If there's an active process, wait for it to finish
    if (managed && managed.proc.exitCode === null && !managed.proc.killed) {
      if (!this.pendingMessages.has(channelId)) {
        this.pendingMessages.set(channelId, []);
      }
      this.pendingMessages.get(channelId)!.push(content);
      return;
    }

    this.processes.delete(channelId);
    this.spawnProcess(channelId, content);
  }

  /** Spawn a new claude process for a channel with a specific prompt. */
  private spawnProcess(channelId: string, prompt: string): ManagedProcess {
    const sessionId = randomUUID();

    const proc = spawn("claude", [
      "--print",
      "--verbose",
      "--output-format", "stream-json",
      "--dangerously-skip-permissions",
      "-p", prompt,
    ], {
      cwd: this.workingDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: sanitizedEnv(),
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
      this.emit("exit", channelId, code);
      this.drainPending(channelId);
    });

    proc.on("error", (err) => {
      this.processes.delete(channelId);
      this.emit("error", channelId, err);
      this.drainPending(channelId);
    });

    console.log(`[claude] Spawned process for channel ${channelId} (session: ${sessionId.slice(0, 8)}...)`);
    return managed;
  }

  /** Process next pending message for a channel after current process finishes. */
  private drainPending(channelId: string): void {
    const pending = this.pendingMessages.get(channelId);
    if (pending && pending.length > 0) {
      const nextMsg = pending.shift()!;
      if (pending.length === 0) this.pendingMessages.delete(channelId);
      // Small delay to avoid rapid respawn
      setTimeout(() => this.sendMessage(channelId, nextMsg), 500);
    }
  }

  private handleStreamEvent(channelId: string, event: Record<string, unknown>): void {
    const type = event.type as string;

    switch (type) {
      case "assistant": {
        // Handle both top-level text and nested message.content structure
        let text: string | undefined;
        if (typeof event.text === "string") {
          text = event.text;
        } else if (event.message && typeof event.message === "object") {
          const msg = event.message as Record<string, unknown>;
          if (Array.isArray(msg.content)) {
            const textBlocks = (msg.content as Array<Record<string, unknown>>)
              .filter(b => b.type === "text" && typeof b.text === "string")
              .map(b => b.text as string);
            if (textBlocks.length > 0) text = textBlocks.join("");
          }
        }
        if (text) {
          this.emit("text", channelId, text);
        }
        break;
      }

      case "result":
        if (typeof event.result === "string") {
          this.emit("result", channelId, event.result);
        } else if (typeof event.text === "string") {
          this.emit("result", channelId, event.text);
        }
        break;

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
