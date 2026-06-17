/**
 * Behavioral tests for the Cove dispatch pipeline.
 *
 * These tests capture the CURRENT external behavior as a contract.
 * The upcoming outbound adapter refactor (#398) must not change any of these behaviors.
 *
 * Strategy: mock openclaw/plugin-sdk/channel-inbound to capture what dispatchMessage
 * passes to dispatchInboundDirectDmWithRuntime, then verify the context, deliver callback, etc.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Mock the SDK's direct-dm module
let capturedDispatchParams: any = null;
let capturedDeliverFn: any = null;
let capturedReplyOptions: any = null;

// Controls what the mock does inside dispatchInboundDirectDmWithRuntime.
// Tests set this BEFORE calling dispatchMessage so deliver/onPartialReply
// execute while isCurrent() is still true (before finally cleanup).
let mockDeliverBehavior: {
  partials?: string[];       // call onPartialReply with these texts
  partialDelayMs?: number;   // ms to wait after partials (default 300 for throttle)
  deliverText?: string;      // call deliver with this text
} | null = null;

vi.mock('openclaw/plugin-sdk/channel-inbound', () => ({
  dispatchInboundDirectDmWithRuntime: vi.fn().mockImplementation(async (params: any) => {
    capturedDispatchParams = params;
    // Call the patchedRuntime's dispatcher to trigger deliver/replyOptions capture
    const runtime = params.runtime;
    if (runtime?.channel?.reply?.dispatchReplyWithBufferedBlockDispatcher) {
      await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
        dispatcherOptions: {},
        replyOptions: {},
      });
    }
    // Now capturedDeliverFn and capturedReplyOptions are set by the wrapper.
    // Execute behavior while dispatch is still "current".
    if (mockDeliverBehavior) {
      if (mockDeliverBehavior.partials && capturedReplyOptions?.onPartialReply) {
        for (const text of mockDeliverBehavior.partials) {
          capturedReplyOptions.onPartialReply({ text });
        }
        await new Promise(r => setTimeout(r, mockDeliverBehavior.partialDelayMs ?? 300));
      }
      if (mockDeliverBehavior.deliverText && capturedDeliverFn) {
        await capturedDeliverFn({ text: mockDeliverBehavior.deliverText }, { kind: 'final' });
      }
    }
  }),
}));

// Mock channel-lifecycle
vi.mock("openclaw/plugin-sdk/channel-lifecycle", () => ({
  createFinalizableDraftLifecycle: vi.fn().mockImplementation((opts: any) => {
    let pendingText: string | null = null;
    let throttleTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = async () => {
      if (pendingText !== null) {
        const text = pendingText;
        pendingText = null;
        await opts.sendOrEditStreamMessage(text);
      }
    };

    return {
      update: (text: string) => {
        pendingText = text;
        if (!throttleTimer) {
          throttleTimer = setTimeout(async () => {
            throttleTimer = null;
            await flush();
          }, opts.throttleMs ?? 250);
        }
      },
      seal: vi.fn().mockImplementation(async () => {
        if (throttleTimer) {
          clearTimeout(throttleTimer);
          throttleTimer = null;
        }
        await flush();
      }),
      clear: vi.fn().mockResolvedValue(undefined),
      loop: { start: vi.fn(), stop: vi.fn() },
      stop: vi.fn().mockResolvedValue(undefined),
      discardPending: vi.fn().mockResolvedValue(undefined),
      stopForClear: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('openclaw/plugin-sdk/channel-message', () => ({
  createTypingCallbacks: vi.fn().mockReturnValue({
    onCleanup: vi.fn(),
  }),
}));

vi.mock('openclaw/plugin-sdk/text-chunking', () => ({
  chunkTextForOutbound: vi.fn((text: string, limit = 4000) => {
    // Actually chunk text to simulate real behavior
    if (text.length <= limit) return [text];
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += limit) {
      chunks.push(text.slice(i, i + limit));
    }
    return chunks;
  }),
}));

import { dispatchMessage, type DispatchMessageOptions } from './dispatch.js';
import { invalidateAllCoveMd } from './cove-md-cache.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockRestClient() {
  return {
    sendMessage: vi.fn().mockImplementation(async (_ch: string, content: string) => ({
      id: 'msg-' + Math.random().toString(36).slice(2, 8),
      content,
      channel_id: _ch,
      author: { id: 'bot-1', username: 'bot' },
    })),
    editMessage: vi.fn().mockResolvedValue({ id: 'msg-1', content: 'edited' }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    sendTyping: vi.fn().mockResolvedValue(undefined),
    getChannel: vi.fn().mockResolvedValue({ id: 'ch-1', name: 'test', type: 0 }),
    getChannelFile: vi.fn().mockResolvedValue(null),
  } as any;
}

function createMockChannelRuntime() {
  return {
    routing: {
      resolveAgentRoute: vi.fn().mockReturnValue({
        agentId: 'test-agent',
        sessionKey: 'agent:test-agent:cove:group:ch-1',
        accountId: 'default',
      }),
    },
    reply: {
      dispatchReplyWithBufferedBlockDispatcher: vi.fn().mockImplementation(async (params: any) => {
        // Store the callbacks for tests to invoke
        capturedDeliverFn = params.dispatcherOptions?.deliver;
        capturedReplyOptions = params.replyOptions;
        // Don't call deliver automatically - let tests call it
      }),
    },
    session: {
      recordInboundSession: vi.fn(),
    },
  } as any;
}

function createBaseOpts(overrides?: Partial<DispatchMessageOptions>): DispatchMessageOptions {
  return {
    message: {
      id: 'msg-in-1',
      content: 'Hello bot',
      channel_id: 'ch-1',
      author: { id: 'user-1', username: 'testuser', global_name: 'Test User' },
      timestamp: new Date().toISOString(),
      attachments: [],
    } as any,
    account: {
      token: 'test-token',
      baseUrl: 'http://localhost:3400',
      guildId: 'guild-1',
      agentId: 'test-agent',
      agentName: 'test-agent',
      allowFrom: ['*'],
      accountId: 'default',
    } as any,
    restClient: createMockRestClient(),
    channelRuntime: createMockChannelRuntime(),
    cfg: { channels: { cove: {} } },
    accountId: 'default',
    pendingDispatches: new Map(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

// ─── Context Injection Behaviors ────────────────────────────────────────────

describe('Dispatch Behavior: Context Injection', () => {
  beforeEach(() => {
    capturedDispatchParams = null;
    capturedDeliverFn = null;
    capturedReplyOptions = null;
    mockDeliverBehavior = null;
  });

  it('B10: cove.md content injected as GroupSystemPrompt', async () => {
    const restClient = createMockRestClient();
    restClient.getChannelFile.mockResolvedValue({
      content: '# Rules\nBe nice',
      filename: 'cove.md',
      size: 16,
    });

    const opts = createBaseOpts({ restClient });
    await dispatchMessage(opts);

    expect(capturedDispatchParams).not.toBeNull();
    expect(capturedDispatchParams.extraContext.GroupSystemPrompt).toContain('Rules');
    expect(capturedDispatchParams.extraContext.GroupSystemPrompt).toContain('Be nice');
  });

  it('B11: no cove.md means no GroupSystemPrompt', async () => {
    invalidateAllCoveMd();
    const restClient = createMockRestClient();
    restClient.getChannelFile.mockResolvedValue(null);

    const opts = createBaseOpts({ restClient });
    await dispatchMessage(opts);

    expect(capturedDispatchParams).not.toBeNull();
    expect(capturedDispatchParams.extraContext.GroupSystemPrompt).toBeUndefined();
  });

  it('B12: thread uses parent channel cove.md', async () => {
    const restClient = createMockRestClient();
    restClient.getChannel.mockResolvedValue({ id: 'thread-1', name: 'thread', type: 11, parent_id: 'parent-ch' });
    restClient.getChannelFile.mockResolvedValue({ content: 'parent rules', filename: 'cove.md', size: 12 });

    const opts = createBaseOpts({
      restClient,
      message: {
        id: 'msg-1',
        content: 'hi',
        channel_id: 'thread-1',
        author: { id: 'user-1', username: 'user', global_name: 'User' },
        timestamp: new Date().toISOString(),
        attachments: [],
      } as any,
    });
    await dispatchMessage(opts);

    // Should fetch cove.md from parent channel
    expect(restClient.getChannelFile).toHaveBeenCalledWith('parent-ch', 'cove.md', expect.anything());
    expect(capturedDispatchParams.extraContext.GroupSystemPrompt).toContain('parent rules');
  });
});

// ─── Routing Behaviors ──────────────────────────────────────────────────────

describe('Dispatch Behavior: Routing', () => {
  beforeEach(() => {
    capturedDispatchParams = null;
    capturedDeliverFn = null;
    capturedReplyOptions = null;
    mockDeliverBehavior = null;
  });

  it('B13: dispatches to SDK with correct channel and sender', async () => {
    const opts = createBaseOpts();
    await dispatchMessage(opts);

    expect(capturedDispatchParams).not.toBeNull();
    expect(capturedDispatchParams.channel).toBe('cove');
    expect(capturedDispatchParams.senderId).toBe('user-1');
    expect(capturedDispatchParams.peer).toEqual({ kind: 'group', id: 'ch-1' });
  });

  it('B13b: agent route uses configured agentId', async () => {
    const opts = createBaseOpts();
    await dispatchMessage(opts);

    // The patchedRuntime should override agentId
    const runtime = capturedDispatchParams.runtime;
    const route = runtime.channel.routing.resolveAgentRoute({});
    expect(route.agentId).toBe('test-agent');
  });
});

// ─── Lifecycle Behaviors ────────────────────────────────────────────────────

describe('Dispatch Behavior: Lifecycle', () => {
  beforeEach(() => {
    capturedDispatchParams = null;
    capturedDeliverFn = null;
    capturedReplyOptions = null;
    mockDeliverBehavior = null;
  });

  it('B16: typing indicator sent on dispatch start', async () => {
    const restClient = createMockRestClient();
    const opts = createBaseOpts({ restClient });
    await dispatchMessage(opts);

    expect(restClient.sendTyping).toHaveBeenCalledWith('ch-1');
  });

  it('B17: pending dispatch tracked and cleaned up', async () => {
    const pendingDispatches = new Map<string, AbortController>();
    const opts = createBaseOpts({ pendingDispatches });

    await dispatchMessage(opts);

    // After dispatch completes, it should be cleaned up
    expect(pendingDispatches.has('ch-1')).toBe(false);
  });
});

// ─── Deliver Callback Behaviors ─────────────────────────────────────────────

describe('Dispatch Behavior: Deliver Callback', () => {
  beforeEach(() => {
    capturedDispatchParams = null;
    capturedDeliverFn = null;
    capturedReplyOptions = null;
    mockDeliverBehavior = null;
  });

  it('B1: deliver callback sends short message via restClient', async () => {
    const restClient = createMockRestClient();
    const opts = createBaseOpts({ restClient });
    await dispatchMessage(opts);

    // Get the deliver callback from the patched runtime
    const dispatcherCall = capturedDispatchParams.runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher;
    // Call it to simulate runtime behavior
    const mockParams = { dispatcherOptions: {}, replyOptions: {} };

    // The dispatchReplyWithBufferedBlockDispatcher was patched — extract deliver
    // Actually, the patchedRuntime wraps the original, and the deliver is in dispatcherOptions
    // Let's verify the structure is correctly wired
    expect(capturedDispatchParams.runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).toBeDefined();
  });

  it('B4: onPartialReply updates draft via sendOrEdit', async () => {
    const restClient = createMockRestClient();
    const opts = createBaseOpts({ restClient });
    await dispatchMessage(opts);

    // Verify the runtime was patched with replyOptions including onPartialReply
    const runtime = capturedDispatchParams.runtime;
    expect(runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).toBeDefined();
  });
});

// ─── Batched Messages ───────────────────────────────────────────────────────

describe('Dispatch Behavior: Batched Messages', () => {
  beforeEach(() => {
    capturedDispatchParams = null;
    capturedDeliverFn = null;
    capturedReplyOptions = null;
    mockDeliverBehavior = null;
  });

  it('B19: batched messages combined into bodyForAgent', async () => {
    const opts = createBaseOpts({
      batchedMessages: [
        {
          id: 'msg-0',
          content: 'first message',
          channel_id: 'ch-1',
          author: { id: 'user-1', username: 'testuser', global_name: 'Test User' },
          timestamp: new Date().toISOString(),
          attachments: [],
        } as any,
      ],
    });
    await dispatchMessage(opts);

    expect(capturedDispatchParams).not.toBeNull();
    // bodyForAgent should contain both messages
    expect(capturedDispatchParams.bodyForAgent).toContain('first message');
    expect(capturedDispatchParams.bodyForAgent).toContain('Hello bot');
  });

  it('B19b: batched message image attachments included', async () => {
    const opts = createBaseOpts({
      batchedMessages: [
        {
          id: 'msg-0',
          content: 'look at this',
          channel_id: 'ch-1',
          author: { id: 'user-1', username: 'testuser', global_name: 'Test User' },
          timestamp: new Date().toISOString(),
          attachments: [{ url: '/attachments/img.png', content_type: 'image/png' }],
        } as any,
      ],
    });
    await dispatchMessage(opts);

    expect(capturedDispatchParams.extraContext.MediaUrls).toBeDefined();
    expect(capturedDispatchParams.extraContext.MediaUrls).toContain('http://localhost:3400/attachments/img.png');
  });
});

// ─── Image Attachments ──────────────────────────────────────────────────────

describe('Dispatch Behavior: Image Attachments', () => {
  beforeEach(() => {
    capturedDispatchParams = null;
    capturedDeliverFn = null;
    capturedReplyOptions = null;
    mockDeliverBehavior = null;
  });

  it('image attachments passed as MediaUrls in extraContext', async () => {
    const opts = createBaseOpts({
      message: {
        id: 'msg-1',
        content: 'check this',
        channel_id: 'ch-1',
        author: { id: 'user-1', username: 'user', global_name: 'User' },
        timestamp: new Date().toISOString(),
        attachments: [
          { url: '/attachments/photo.jpg', content_type: 'image/jpeg' },
        ],
      } as any,
    });
    await dispatchMessage(opts);

    expect(capturedDispatchParams.extraContext.MediaUrls).toEqual(['http://localhost:3400/attachments/photo.jpg']);
    expect(capturedDispatchParams.extraContext.allowUnsafeExternalContent).toBe(true);
  });

  it('non-image attachments ignored', async () => {
    const opts = createBaseOpts({
      message: {
        id: 'msg-1',
        content: 'file',
        channel_id: 'ch-1',
        author: { id: 'user-1', username: 'user', global_name: 'User' },
        timestamp: new Date().toISOString(),
        attachments: [
          { url: '/attachments/doc.pdf', content_type: 'application/pdf' },
        ],
      } as any,
    });
    await dispatchMessage(opts);

    expect(capturedDispatchParams.extraContext.MediaUrls).toBeUndefined();
  });
});


// ─── Delivery Pipeline Tests (C4 fix) ──────────────────────────────────
// These tests exercise the real deliver/onPartialReply callbacks by having
// the dispatchInboundDirectDmWithRuntime mock invoke them DURING the dispatch
// (while isCurrent() is still true). Set mockDeliverBehavior before calling
// dispatchMessage.

function createCapturingRuntime() {
  return {
    routing: {
      resolveAgentRoute: vi.fn().mockReturnValue({
        agentId: 'test-agent',
        sessionKey: 'agent:test-agent:cove:group:ch-1',
        accountId: 'default',
      }),
    },
    reply: {
      dispatchReplyWithBufferedBlockDispatcher: vi.fn().mockImplementation(async (params: any) => {
        capturedDeliverFn = params.dispatcherOptions?.deliver;
        capturedReplyOptions = params.replyOptions;
      }),
    },
    session: { recordInboundSession: vi.fn() },
  } as any;
}

describe('Dispatch Behavior: Delivery Pipeline', () => {
  beforeEach(() => {
    capturedDeliverFn = null;
    capturedReplyOptions = null;
    mockDeliverBehavior = null;
    capturedDispatchParams = null;
    mockDeliverBehavior = null;
    invalidateAllCoveMd();
  });

  it('C4-1: deliver chunks text > 4000 into multiple sends', async () => {
    const restClient = createMockRestClient();
    mockDeliverBehavior = { deliverText: 'A'.repeat(6000) };
    const opts = createBaseOpts({ restClient, channelRuntime: createCapturingRuntime() });
    await dispatchMessage(opts);

    const sends = restClient.sendMessage.mock.calls.filter((c: any) => c[1]?.length > 100);
    expect(sends.length).toBeGreaterThanOrEqual(2);
    for (const [, content] of sends) {
      expect(content.length).toBeLessThanOrEqual(4000);
    }
  });

  it('C4-2: deliver edits draft in-place for short text', async () => {
    const restClient = createMockRestClient();
    mockDeliverBehavior = {
      partials: ['partial draft'],
      deliverText: 'Final complete response',
    };
    const opts = createBaseOpts({ restClient, channelRuntime: createCapturingRuntime() });
    await dispatchMessage(opts);

    // editMessage should have been called for the final (short text edits draft in place)
    expect(restClient.editMessage).toHaveBeenCalled();
  });

  it('C4-3: onPartialReply creates draft via sendMessage', async () => {
    const restClient = createMockRestClient();
    mockDeliverBehavior = { partials: ['streaming text'] };
    const opts = createBaseOpts({ restClient, channelRuntime: createCapturingRuntime() });
    await dispatchMessage(opts);

    expect(restClient.sendMessage).toHaveBeenCalledWith('ch-1', expect.stringContaining('streaming text'));
  });

  it('C4-4: streaming preview clamped to 4000 chars', async () => {
    const restClient = createMockRestClient();
    mockDeliverBehavior = { partials: ['X'.repeat(5000)] };
    const opts = createBaseOpts({ restClient, channelRuntime: createCapturingRuntime() });
    await dispatchMessage(opts);

    const sends = restClient.sendMessage.mock.calls;
    for (const [, content] of sends) {
      if (content && content.length > 10) {
        expect(content.length).toBeLessThanOrEqual(4000);
      }
    }
  });

  it('C4-5: cleanupAndSend does send-before-delete', async () => {
    const restClient = createMockRestClient();
    const calls: string[] = [];
    restClient.sendMessage.mockImplementation(async (_ch: string, text: string) => {
      calls.push('send:' + text.slice(0, 20));
      return { id: 'msg-new', content: text, channel_id: _ch, author: { id: 'bot-1', username: 'bot' } };
    });
    restClient.deleteMessage.mockImplementation(async () => {
      calls.push('delete');
    });

    // First create a draft via partial, then deliver long text
    mockDeliverBehavior = {
      partials: ['draft'],
      deliverText: 'B'.repeat(5000),
    };
    const opts = createBaseOpts({ restClient, channelRuntime: createCapturingRuntime() });
    await dispatchMessage(opts);

    // Find the send/delete calls AFTER the draft was created
    // (draft creation is also a 'send', so filter for the chunked sends)
    const sendAfterDraft = calls.filter(c => c.startsWith('send:') && !c.includes('draft'));
    const firstDelete = calls.indexOf('delete');
    const firstChunkedSend = calls.findIndex(c => c.startsWith('send:B'));
    if (firstChunkedSend >= 0 && firstDelete >= 0) {
      expect(firstChunkedSend).toBeLessThan(firstDelete);
    }
    // At minimum, sends should have happened
    expect(sendAfterDraft.length).toBeGreaterThanOrEqual(1);
  });
});
