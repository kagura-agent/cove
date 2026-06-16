import type { Message } from '@cove/shared';

export interface QueuedMessage {
  message: Message;
  enqueuedAt: number;
}

type DispatchFn = (message: Message) => Promise<void>;
type BatchDispatchFn = (messages: Message[]) => Promise<void>;

const MAX_QUEUE_SIZE = 5;

export class ChannelMessageQueue {
  private queues = new Map<string, QueuedMessage[]>();
  private processing = new Map<string, boolean>();
  private dispatchFn: DispatchFn;
  private batchDispatchFn?: BatchDispatchFn;
  private log?: { info?: (...a: any[]) => void; warn?: (...a: any[]) => void };

  constructor(dispatchFn: DispatchFn, opts?: { batchDispatchFn?: BatchDispatchFn; log?: { info?: (...a: any[]) => void; warn?: (...a: any[]) => void } } | { info?: (...a: any[]) => void; warn?: (...a: any[]) => void }) {
    this.dispatchFn = dispatchFn;
    if (opts && 'batchDispatchFn' in opts) {
      this.batchDispatchFn = opts.batchDispatchFn;
      this.log = opts.log;
    } else {
      this.log = opts as any;
    }
  }

  enqueue(message: Message): void {
    const channelId = message.channel_id;
    let queue = this.queues.get(channelId);
    if (!queue) { queue = []; this.queues.set(channelId, queue); }
    if (queue.length >= MAX_QUEUE_SIZE) {
      const dropped = queue.shift()!;
      this.log?.warn?.('cove: queue full for [' + channelId + '], dropping oldest message ' + dropped.message.id);
    }
    queue.push({ message, enqueuedAt: Date.now() });
    this.log?.info?.('cove: enqueued message for [' + channelId + '] (queue: ' + queue.length + ')');
    if (!this.processing.get(channelId)) { this.processNext(channelId); }
  }

  private async processNext(channelId: string): Promise<void> {
    const queue = this.queues.get(channelId);
    if (!queue || queue.length === 0) { this.processing.delete(channelId); return; }
    this.processing.set(channelId, true);
    const items = queue.splice(0);
    try {
      if (items.length === 1 || !this.batchDispatchFn) {
        for (const item of items) { await this.dispatchFn(item.message); }
      } else {
        this.log?.info?.('cove: batching ' + items.length + ' messages for [' + channelId + ']');
        await this.batchDispatchFn(items.map(i => i.message));
      }
    } catch (err: any) {
      this.log?.warn?.('cove: dispatch error for [' + channelId + ']: ' + err.message);
    }
    await this.processNext(channelId);
  }

  clearAll(): void { this.queues.clear(); }
  clear(channelId: string): void { this.queues.delete(channelId); }
  size(channelId: string): number { return this.queues.get(channelId)?.length ?? 0; }
}
