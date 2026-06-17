/**
 * Cove thread binding manager.
 *
 * Tracks subagent session ↔ thread bindings. Mirrors Discord's
 * ThreadBindingManager pattern but simplified (no webhooks, in-memory).
 */

import type { CoveRestClient } from './rest-client.js';

const DEFAULT_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 168h
const DEFAULT_SWEEP_INTERVAL_MS = 60_000; // 1min
const MAX_BINDINGS_PER_CHANNEL = 10;
const DEFAULT_AUTO_ARCHIVE_DURATION = 1440; // 24h in minutes

export interface ThreadBindingRecord {
  sessionKey: string;
  threadId: string;
  parentChannelId: string;
  accountId: string;
  agentId?: string;
  label?: string;
  boundAt: number;
  lastActivityAt: number;
  idleTimeoutMs: number;
  maxAgeMs: number;
}

export interface CoveThreadBindingManager {
  accountId: string;
  bindTarget(params: {
    targetSessionKey: string;
    channelId: string;
    threadId?: string;
    createThread?: boolean;
    threadName?: string;
    agentId?: string;
    label?: string;
    introText?: string;
  }): Promise<ThreadBindingRecord | null>;
  unbindThread(params: {
    threadId: string;
    reason?: string;
    sendFarewell?: boolean;
    farewellText?: string;
  }): ThreadBindingRecord | null;
  unbindBySessionKey(targetSessionKey: string): ThreadBindingRecord[];
  getByThreadId(threadId: string): ThreadBindingRecord | undefined;
  getBySessionKey(targetSessionKey: string): ThreadBindingRecord | undefined;
  listBindings(): ThreadBindingRecord[];
  touchThread(threadId: string): void;
  runSweep(): void;
  startSweeper(): void;
  stopSweeper(): void;
}

export function createCoveThreadBindingManager(params: {
  restClient: CoveRestClient;
  accountId: string;
  idleTimeoutMs?: number;
  maxAgeMs?: number;
  sweepIntervalMs?: number;
  log?: { info?: (...a: any[]) => void; warn?: (...a: any[]) => void };
}): CoveThreadBindingManager {
  const {
    restClient,
    accountId,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    maxAgeMs = DEFAULT_MAX_AGE_MS,
    sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS,
    log,
  } = params;

  const bindings = new Map<string, ThreadBindingRecord>(); // threadId -> record
  let sweepTimer: ReturnType<typeof setInterval> | null = null;

  function countBindingsForChannel(channelId: string): number {
    let count = 0;
    for (const r of bindings.values()) {
      if (r.parentChannelId === channelId) count++;
    }
    return count;
  }

  const manager: CoveThreadBindingManager = {
    accountId,

    async bindTarget(bindParams) {
      let threadId = bindParams.threadId;
      const channelId = bindParams.channelId;

      if (!channelId) return null;

      // Rate limit: max bindings per channel
      if (countBindingsForChannel(channelId) >= MAX_BINDINGS_PER_CHANNEL) {
        log?.warn?.('cove: thread binding rejected — max ' + MAX_BINDINGS_PER_CHANNEL + ' active bindings for channel ' + channelId);
        return null;
      }

      // Create thread if needed
      if (!threadId && bindParams.createThread) {
        const threadName = (bindParams.threadName || bindParams.label || 'Subagent task').slice(0, 80);
        try {
          const thread = await restClient.createStandaloneThread(channelId, threadName, DEFAULT_AUTO_ARCHIVE_DURATION);
          threadId = thread.id;
          log?.info?.('cove: created thread ' + threadId + ' (' + threadName + ') in channel ' + channelId);
        } catch (err: any) {
          log?.warn?.('cove: failed to create thread in ' + channelId + ': ' + err.message);
          return null;
        }
      }

      if (!threadId) return null;

      const now = Date.now();
      const record: ThreadBindingRecord = {
        sessionKey: bindParams.targetSessionKey,
        threadId,
        parentChannelId: channelId,
        accountId,
        agentId: bindParams.agentId,
        label: bindParams.label,
        boundAt: now,
        lastActivityAt: now,
        idleTimeoutMs,
        maxAgeMs,
      };

      bindings.set(threadId, record);

      // Send intro message
      if (bindParams.introText) {
        restClient.sendMessage(threadId, bindParams.introText).catch((err: any) => {
          log?.warn?.('cove: failed to send intro to thread ' + threadId + ': ' + err.message);
        });
      }

      return record;
    },

    unbindThread(unbindParams) {
      const record = bindings.get(unbindParams.threadId);
      if (!record) return null;

      bindings.delete(unbindParams.threadId);

      if (unbindParams.sendFarewell !== false) {
        const text = unbindParams.farewellText || 'Session unbound (reason: ' + (unbindParams.reason || 'manual') + ')';
        restClient.sendMessage(unbindParams.threadId, text).catch((err: any) => {
          log?.warn?.('cove: failed to send farewell to thread ' + unbindParams.threadId + ': ' + err.message);
        });
      }

      return record;
    },

    unbindBySessionKey(targetSessionKey) {
      const removed: ThreadBindingRecord[] = [];
      for (const [threadId, record] of bindings.entries()) {
        if (record.sessionKey === targetSessionKey) {
          const r = manager.unbindThread({ threadId, reason: 'session-ended', sendFarewell: true });
          if (r) removed.push(r);
        }
      }
      return removed;
    },

    getByThreadId(threadId) {
      return bindings.get(threadId);
    },

    getBySessionKey(targetSessionKey) {
      for (const record of bindings.values()) {
        if (record.sessionKey === targetSessionKey) return record;
      }
      return undefined;
    },

    listBindings() {
      return [...bindings.values()];
    },

    touchThread(threadId) {
      const record = bindings.get(threadId);
      if (record) record.lastActivityAt = Date.now();
    },

    runSweep() {
      const now = Date.now();
      for (const [threadId, record] of bindings.entries()) {
        // Check idle timeout
        const idleExpiry = record.lastActivityAt + record.idleTimeoutMs;
        if (now >= idleExpiry) {
          log?.info?.('cove: thread binding idle expired — thread ' + threadId);
          manager.unbindThread({
            threadId,
            reason: 'idle-expired',
            sendFarewell: true,
            farewellText: 'Session unbound — idle for ' + Math.round(record.idleTimeoutMs / 3600000) + 'h',
          });
          continue;
        }

        // Check max age
        if (record.maxAgeMs > 0) {
          const maxAgeExpiry = record.boundAt + record.maxAgeMs;
          if (now >= maxAgeExpiry) {
            log?.info?.('cove: thread binding max age expired — thread ' + threadId);
            manager.unbindThread({
              threadId,
              reason: 'max-age-expired',
              sendFarewell: true,
              farewellText: 'Session unbound — max age ' + Math.round(record.maxAgeMs / 3600000) + 'h reached',
            });
          }
        }
      }
    },

    startSweeper() {
      if (sweepTimer) return;
      sweepTimer = setInterval(() => manager.runSweep(), sweepIntervalMs);
      sweepTimer.unref?.();
    },

    stopSweeper() {
      if (sweepTimer) {
        clearInterval(sweepTimer);
        sweepTimer = null;
      }
    },
  };

  return manager;
}
