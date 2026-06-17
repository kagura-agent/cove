import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCoveThreadBindingManager } from './thread-bindings.js';

/** Create a mock CoveRestClient */
function createMockRestClient() {
  let threadCounter = 0;
  return {
    sendMessage: vi.fn().mockResolvedValue({ id: 'msg-1', content: '' }),
    createStandaloneThread: vi.fn().mockImplementation(async (_channelId: string, name: string) => ({
      id: 'thread-' + (++threadCounter),
      name,
      type: 11,
      parent_id: _channelId,
    })),
    modifyChannel: vi.fn().mockResolvedValue({}),
    // Stub other methods the manager doesn't use
    editMessage: vi.fn(),
    deleteMessage: vi.fn(),
    getChannel: vi.fn(),
    getChannels: vi.fn(),
    sendTyping: vi.fn(),
    getMessage: vi.fn(),
    getMessages: vi.fn(),
    getMe: vi.fn(),
    getUser: vi.fn(),
    createWebhook: vi.fn(),
    getWebhooks: vi.fn(),
    executeWebhook: vi.fn(),
    getChannelFile: vi.fn(),
    getGatewayUrl: vi.fn(),
    createThreadFromMessage: vi.fn(),
  } as any;
}

describe('CoveThreadBindingManager', () => {
  let restClient: ReturnType<typeof createMockRestClient>;
  let manager: ReturnType<typeof createCoveThreadBindingManager>;

  beforeEach(() => {
    restClient = createMockRestClient();
    manager = createCoveThreadBindingManager({
      restClient,
      accountId: 'test-account',
      idleTimeoutMs: 1000, // 1s for testing
      maxAgeMs: 5000,      // 5s for testing
    });
  });

  it('creates a thread and binds target', async () => {
    const record = await manager.bindTarget({
      targetSessionKey: 'agent:bot:cove:group:ch1',
      channelId: 'ch1',
      createThread: true,
      threadName: 'Fix bug #42',
      agentId: 'subagent-1',
      label: 'Fix bug #42',
    });

    expect(record).not.toBeNull();
    expect(record!.sessionKey).toBe('agent:bot:cove:group:ch1');
    expect(record!.threadId).toBe('thread-1');
    expect(record!.parentChannelId).toBe('ch1');
    expect(record!.agentId).toBe('subagent-1');
    expect(restClient.createStandaloneThread).toHaveBeenCalledWith('ch1', 'Fix bug #42', 1440);
  });

  it('binds to existing thread without creating', async () => {
    const record = await manager.bindTarget({
      targetSessionKey: 'session-1',
      channelId: 'ch1',
      threadId: 'existing-thread',
    });

    expect(record).not.toBeNull();
    expect(record!.threadId).toBe('existing-thread');
    expect(restClient.createStandaloneThread).not.toHaveBeenCalled();
  });

  it('sends intro message when provided', async () => {
    await manager.bindTarget({
      targetSessionKey: 'session-1',
      channelId: 'ch1',
      createThread: true,
      introText: 'Starting work...',
    });

    // Wait for fire-and-forget sendMessage
    await new Promise(r => setTimeout(r, 10));
    expect(restClient.sendMessage).toHaveBeenCalledWith('thread-1', 'Starting work...');
  });

  it('looks up binding by thread ID', async () => {
    await manager.bindTarget({
      targetSessionKey: 'session-1',
      channelId: 'ch1',
      threadId: 't1',
    });

    expect(manager.getByThreadId('t1')).toBeDefined();
    expect(manager.getByThreadId('t1')!.sessionKey).toBe('session-1');
    expect(manager.getByThreadId('nonexistent')).toBeUndefined();
  });

  it('looks up binding by session key', async () => {
    await manager.bindTarget({
      targetSessionKey: 'session-1',
      channelId: 'ch1',
      threadId: 't1',
    });

    expect(manager.getBySessionKey('session-1')).toBeDefined();
    expect(manager.getBySessionKey('session-1')!.threadId).toBe('t1');
    expect(manager.getBySessionKey('nonexistent')).toBeUndefined();
  });

  it('unbinds thread and sends farewell', async () => {
    await manager.bindTarget({
      targetSessionKey: 'session-1',
      channelId: 'ch1',
      threadId: 't1',
    });

    const removed = manager.unbindThread({ threadId: 't1', reason: 'completed' });
    expect(removed).not.toBeNull();
    expect(removed!.sessionKey).toBe('session-1');
    expect(manager.getByThreadId('t1')).toBeUndefined();

    // Wait for fire-and-forget farewell
    await new Promise(r => setTimeout(r, 10));
    expect(restClient.sendMessage).toHaveBeenCalledWith('t1', 'Session unbound (reason: completed)');
  });

  it('unbinds by session key', async () => {
    await manager.bindTarget({ targetSessionKey: 'session-1', channelId: 'ch1', threadId: 't1' });
    await manager.bindTarget({ targetSessionKey: 'session-1', channelId: 'ch1', threadId: 't2' });
    await manager.bindTarget({ targetSessionKey: 'session-2', channelId: 'ch1', threadId: 't3' });

    const removed = manager.unbindBySessionKey('session-1');
    expect(removed).toHaveLength(2);
    expect(manager.getByThreadId('t1')).toBeUndefined();
    expect(manager.getByThreadId('t2')).toBeUndefined();
    expect(manager.getByThreadId('t3')).toBeDefined();
  });

  it('touches thread to update activity', async () => {
    await manager.bindTarget({ targetSessionKey: 's1', channelId: 'ch1', threadId: 't1' });

    const before = manager.getByThreadId('t1')!.lastActivityAt;
    await new Promise(r => setTimeout(r, 10));
    manager.touchThread('t1');
    const after = manager.getByThreadId('t1')!.lastActivityAt;

    expect(after).toBeGreaterThan(before);
  });

  it('enforces max bindings per channel', async () => {
    // Bind 10 (the limit)
    for (let i = 0; i < 10; i++) {
      const r = await manager.bindTarget({ targetSessionKey: 's' + i, channelId: 'ch1', threadId: 't' + i });
      expect(r).not.toBeNull();
    }

    // 11th should fail
    const r = await manager.bindTarget({ targetSessionKey: 's10', channelId: 'ch1', threadId: 't10' });
    expect(r).toBeNull();

    // Different channel should work
    const r2 = await manager.bindTarget({ targetSessionKey: 's11', channelId: 'ch2', threadId: 't11' });
    expect(r2).not.toBeNull();
  });

  it('sweeps idle bindings', async () => {
    await manager.bindTarget({ targetSessionKey: 's1', channelId: 'ch1', threadId: 't1' });

    // Wait for idle timeout (1s)
    await new Promise(r => setTimeout(r, 1100));

    manager.runSweep();
    expect(manager.getByThreadId('t1')).toBeUndefined();
  });

  it('does not sweep active bindings', async () => {
    await manager.bindTarget({ targetSessionKey: 's1', channelId: 'ch1', threadId: 't1' });

    // Touch before timeout
    await new Promise(r => setTimeout(r, 500));
    manager.touchThread('t1');

    // Wait a bit more but not past idle timeout from last touch
    await new Promise(r => setTimeout(r, 600));

    manager.runSweep();
    expect(manager.getByThreadId('t1')).toBeDefined();
  });

  it('returns null when createThread fails', async () => {
    restClient.createStandaloneThread.mockRejectedValueOnce(new Error('403 Forbidden'));

    const record = await manager.bindTarget({
      targetSessionKey: 's1',
      channelId: 'ch1',
      createThread: true,
    });

    expect(record).toBeNull();
  });

  it('lists all bindings', async () => {
    await manager.bindTarget({ targetSessionKey: 's1', channelId: 'ch1', threadId: 't1' });
    await manager.bindTarget({ targetSessionKey: 's2', channelId: 'ch2', threadId: 't2' });

    const list = manager.listBindings();
    expect(list).toHaveLength(2);
  });

  it('truncates thread name to 80 chars', async () => {
    const longName = 'A'.repeat(100);
    await manager.bindTarget({
      targetSessionKey: 's1',
      channelId: 'ch1',
      createThread: true,
      threadName: longName,
    });

    expect(restClient.createStandaloneThread).toHaveBeenCalledWith('ch1', 'A'.repeat(80), 1440);
  });
});
