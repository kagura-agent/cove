/**
 * Per-channel message queue for sequential dispatch.
 *
 * Ensures only one dispatch runs per channel at a time. New messages are
 * queued and processed in order after the current dispatch completes.
 * Prevents the lost-reply problem where a new message would abort an
 * in-progress dispatch.
 *
 * When multiple messages are queued, they can be batched into a single
 * dispatch via the optional batchDispatchFn.
 */

import type { Message } from '@cove/shared';

export interface QueuedMessage {
  message: Message;
  enqueuedAt: number;
}

type DispatchFn = (message: Message) => Promise<void>;
type BatchDispatchFn = (messages: Message[]) => Promise<void>;

export interface ChannelMessageQueueOptions {
  dispatchFn: DispatchFn;
  batchDispatchFn?: BatchDispatchFn;
  log?: { info?: (...a: any[]) => void; warn?: (...a: any[]) => void };
}

const MAX_QUEUE_SIZE = 5;

export class ChannelMessageQueue {
  private queues = new Map<string, QueuedMessage[]>();
  private processing = new Map<string, boolean>();
  private dispatchFn: DispatchFn;
  private batchDispatchFn?: BatchDispatchFn;
  private log?: { info?: (...a: any[]) => void; warn?: (...a: any[]) => void };

  constructor(opts: ChannelMessageQueueOptions) {
    this.dispatchFn = opts.dispatchFn;
    this.batchDispatchFn = opts.batchDispatchFn;
    this.log = opts.log;
  }

  enqueue(message: Message): void {
    const channelId = message.channel_id;
    let queue = this.queues.get(channelId);
    if (!queue) {
      queue = [];
      this.queues.set(channelId, queue);
    }

    // If queue is full, drop oldest
    if (queue.length >= MAX_QUEUE_SIZE) {
      const dropped = queue.shift()!;
      this.log?.warn?.(`cove: queue full for [${channelId}], dropping oldest message ${dropped.message.id}`);
    }

    queue.push({ message, enqueuedAt: Date.now() });
    this.log?.info?.(`cove: enqueued message for [${channelId}] (queue: ${queue.length})`);

    // If not currently processing, start processing
    // Enqueues during an active dispatch are held until processNext recurses.
    if (!this.processing.get(channelId)) {
      this.processNext(channelId);
    }
  }

  private async processNext(channelId: string): Promise<void> {
    const queue = this.queues.get(channelId);
    if (!queue || queue.length === 0) {
      this.processing.delete(channelId);
      return;
    }

    this.processing.set(channelId, true);

    // Drain all queued messages at once
    const items = queue.splice(0);

    try {
      if (items.length === 1 || !this.batchDispatchFn) {
        // Single message or no batch handler — dispatch one by one
        for (const item of items) {
          await this.dispatchFn(item.message);
        }
      } else {
        // Multiple messages — batch dispatch
        this.log?.info?.(`cove: batching ${items.length} messages for [${channelId}]`);
        await this.batchDispatchFn(items.map((i) => i.message));
      }
    } catch (err: any) {
      this.log?.warn?.(`cove: dispatch error for [${channelId}] (batch: ${items.length}, ids: ${items.map((i) => i.message.id).join(',')}): ${err.message}`);
    }

    // Process next in queue (messages may have arrived during dispatch)
    await this.processNext(channelId);
  }

  /** Clear all queues (e.g., on reconnect) */
  clearAll(): void {
    this.queues.clear();
    // Don't clear processing flags — in-flight dispatches will finish naturally
  }

  /** Clear queue for a specific channel */
  clear(channelId: string): void {
    this.queues.delete(channelId);
  }

  /** Get queue size for a channel */
  size(channelId: string): number {
    return this.queues.get(channelId)?.length ?? 0;
  }
}
