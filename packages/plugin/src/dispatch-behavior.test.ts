/**
 * Behavioral contract tests for dispatch.ts
 * Tests 32 behavior contracts from SPEC-398.md Section 2.
 * Groups: A (Draft Streaming), B (Final Delivery), D (Context),
 *         E (Tool Progress), F (Lifecycle), G (Batched)
 * Note: Group C skipped — not on main branch.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

let capturedDispatcherParams: any = null;
let capturedResolvedTurn: any = null;
let dispatchBlocker: { resolve: () => void; promise: Promise<void> } | null = null;

function createDispatchBlocker() {
  let resolve: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  dispatchBlocker = { resolve: resolve!, promise };
  return dispatchBlocker;
}

vi.mock("openclaw/plugin-sdk/inbound-reply-dispatch", () => ({
  runInboundReplyTurn: vi.fn(async (params: any) => {
    // Mimic the kernel: call ingest, then resolveTurn, then runDispatch.
    // Capture the resolved turn so tests can inspect ctxPayload, etc.
    const ingested = await params.adapter.ingest(params.raw);
    const resolved = await params.adapter.resolveTurn(ingested, {} as any, {} as any);
    capturedResolvedTurn = resolved;
    if (resolved && (resolved as any).runDispatch) {
      await (resolved as any).runDispatch();
    }
    if (dispatchBlocker) await dispatchBlocker.promise;
  }),
}));

vi.mock("openclaw/plugin-sdk/channel-message", () => ({
  createTypingCallbacks: vi.fn(() => ({ onReplyStart: vi.fn(async () => {}), onCleanup: vi.fn() })),
  sendDurableMessageBatch: vi.fn(async () => ({ status: "sent", outcomes: [] })),
  buildChannelProgressDraftLineForEntry: vi.fn((_entry: any, input: any) => input),
  buildChannelProgressDraftLine: vi.fn((input: any) => input),
  defineFinalizableLivePreviewAdapter: vi.fn((adapter: any) => adapter),
  deliverWithFinalizableLivePreviewAdapter: vi.fn(async (params: any) => {
    // By default, simulate that we fall through to normal delivery
    if (params.deliverNormally) await params.deliverNormally(params.payload);
    if (params.onNormalDelivered) params.onNormalDelivered();
    return { kind: "normal-delivered" };
  }),
  resolveChannelStreamingBlockEnabled: vi.fn(() => undefined),
}));

let mockDraftPreviewController: any = null;

vi.mock("./draft-preview.js", () => ({
  createCoveDraftPreviewController: vi.fn((_params: any) => {
    const ctrl = {
      draftStream: {
        update: vi.fn(),
        flush: vi.fn(async () => {}),
        messageId: vi.fn(() => undefined),
        clear: vi.fn(async () => {}),
        deleteCurrentMessage: vi.fn(async () => {}),
        discardPending: vi.fn(async () => {}),
        seal: vi.fn(async () => {}),
        stop: vi.fn(),
        forceNewMessage: vi.fn(),
      },
      isProgressMode: false,
      hasProgressDraftStarted: false,
      finalizedViaPreviewMessage: false,
      previewToolProgressEnabled: false,
      commentaryProgressEnabled: false,
      suppressDefaultToolProgressMessages: true,
      disableBlockStreamingForDraft: true,
      markFinalReplyStarted: vi.fn(),
      markFinalReplyDelivered: vi.fn(),
      markPreviewFinalized: vi.fn(),
      startProgressDraft: vi.fn(async () => {}),
      pushToolProgress: vi.fn(async () => {}),
      pushReasoningProgress: vi.fn(async () => {}),
      pushCommentaryProgress: vi.fn(async () => {}),
      resolvePreviewFinalText: vi.fn(() => undefined),
      updateFromPartial: vi.fn(),
      handleAssistantMessageBoundary: vi.fn(),
      flush: vi.fn(async () => {}),
      cleanup: vi.fn(async () => {}),
    };
    mockDraftPreviewController = ctrl;
    return ctrl;
  }),
}));

vi.mock("./cove-md-cache.js", () => ({ getCoveMd: vi.fn() }));

import { dispatchMessage, type DispatchMessageOptions } from "./dispatch.js";
import { createTypingCallbacks } from "openclaw/plugin-sdk/channel-message";
import { getCoveMd } from "./cove-md-cache.js";
import { createCoveDraftPreviewController } from "./draft-preview.js";

const loadInbound = () => import("openclaw/plugin-sdk/inbound-reply-dispatch");

interface MockRestClient { sendTyping: Mock; sendMessage: Mock; editMessage: Mock; deleteMessage: Mock; getChannel: Mock; }

const createMockRestClient = (): MockRestClient => ({
  sendTyping: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue({ id: "msg-draft-1" }),
  editMessage: vi.fn().mockResolvedValue({ id: "msg-draft-1" }),
  deleteMessage: vi.fn().mockResolvedValue(undefined),
  getChannel: vi.fn().mockResolvedValue({ id: "ch-1", type: 0 }),
});

const createMockChannelRuntime = () => ({
  routing: { resolveAgentRoute: vi.fn().mockReturnValue({ agentId: "original-agent", sessionKey: "agent:original-agent:cove:group:ch-1" }) },
  reply: { dispatchReplyWithBufferedBlockDispatcher: vi.fn((params: any) => { capturedDispatcherParams = params; return Promise.resolve(); }) },
  session: { recordInboundSession: vi.fn(async () => ({})) },
});

const createTestMessage = (overrides: Partial<any> = {}): any => ({
  id: "msg-1", channel_id: "ch-1", content: "Hello world",
  author: { id: "user-1", username: "testuser", global_name: "Test User" },
  timestamp: new Date().toISOString(), attachments: [], ...overrides,
});

const createBaseOpts = (overrides: Partial<DispatchMessageOptions> = {}): DispatchMessageOptions => ({
  message: createTestMessage(),
  account: { accountId: "test-account", token: "test-token", baseUrl: "http://localhost:3400",
             guildId: "guild-1", agentId: "test-agent", agentName: "Test Agent", allowFrom: [], dmPolicy: undefined },
  restClient: createMockRestClient() as any, channelRuntime: createMockChannelRuntime(),
  cfg: { channels: { cove: {} } }, accountId: "test-account", pendingDispatches: new Map(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, ...overrides,
});

const resetState = () => { vi.clearAllMocks(); capturedDispatcherParams = null; capturedResolvedTurn = null; dispatchBlocker = null; mockDraftPreviewController = null; };

describe("A. Draft Streaming Lifecycle", () => {
  beforeEach(resetState);

  it("A1: Draft preview controller created with correct params", async () => {
    await dispatchMessage(createBaseOpts());
    expect(createCoveDraftPreviewController).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "test-account",
      deliverChannelId: "ch-1",
      textLimit: expect.any(Number),
    }));
  });

  it("A2: Draft stream passed through to replyOptions callbacks", async () => {
    await dispatchMessage(createBaseOpts());
    // onPartialReply should be wired when draftStream exists and not progress mode
    expect(capturedDispatcherParams?.replyOptions?.onPartialReply).toBeDefined();
  });

  it("A3: onPartialReply calls updateFromPartial on controller", async () => {
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(createBaseOpts()); await new Promise((r) => setTimeout(r, 50));
    const onPartialReply = capturedDispatcherParams?.replyOptions?.onPartialReply;
    if (onPartialReply) onPartialReply({ text: "Hello" });
    expect(mockDraftPreviewController?.updateFromPartial).toHaveBeenCalledWith("Hello");
    blocker.resolve(); await p;
  });

  it("A4: onAssistantMessageStart calls handleAssistantMessageBoundary", async () => {
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(createBaseOpts()); await new Promise((r) => setTimeout(r, 50));
    const onAssistantMessageStart = capturedDispatcherParams?.replyOptions?.onAssistantMessageStart;
    if (onAssistantMessageStart) onAssistantMessageStart();
    expect(mockDraftPreviewController?.handleAssistantMessageBoundary).toHaveBeenCalled();
    blocker.resolve(); await p;
  });

  it("A5: onReasoningEnd calls handleAssistantMessageBoundary", async () => {
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(createBaseOpts()); await new Promise((r) => setTimeout(r, 50));
    const onReasoningEnd = capturedDispatcherParams?.replyOptions?.onReasoningEnd;
    if (onReasoningEnd) onReasoningEnd();
    expect(mockDraftPreviewController?.handleAssistantMessageBoundary).toHaveBeenCalled();
    blocker.resolve(); await p;
  });

  it("A6: onReasoningStream calls pushReasoningProgress", async () => {
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(createBaseOpts()); await new Promise((r) => setTimeout(r, 50));
    const onReasoningStream = capturedDispatcherParams?.replyOptions?.onReasoningStream;
    if (onReasoningStream) await onReasoningStream({ text: "thinking...", isReasoningSnapshot: true });
    expect(mockDraftPreviewController?.pushReasoningProgress).toHaveBeenCalledWith("thinking...", { snapshot: true });
    blocker.resolve(); await p;
  });

  it("A7: disableBlockStreaming is config-driven", async () => {
    await dispatchMessage(createBaseOpts());
    // With default mock (disableBlockStreamingForDraft=true), should be true
    expect(capturedDispatcherParams?.replyOptions?.disableBlockStreaming).toBe(true);
  });

  it("A8: suppressDefaultToolProgressMessages is config-driven", async () => {
    await dispatchMessage(createBaseOpts());
    expect(capturedDispatcherParams?.replyOptions?.suppressDefaultToolProgressMessages).toBe(true);
  });
});

describe("B. Final Delivery", () => {
  beforeEach(resetState);

  it("B1: Final delivery uses finalization adapter", async () => {
    const { deliverWithFinalizableLivePreviewAdapter } = await import("openclaw/plugin-sdk/channel-message");
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(createBaseOpts()); await new Promise((r) => setTimeout(r, 50));
    vi.mocked(deliverWithFinalizableLivePreviewAdapter).mockClear();
    const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
    if (deliver) await deliver({ text: "Final" }, { kind: "final" });
    expect(deliverWithFinalizableLivePreviewAdapter).toHaveBeenCalled();
    blocker.resolve(); await p;
  });

  it("B2: Fresh send via sendDurableMessageBatch as fallback", async () => {
    const { sendDurableMessageBatch } = await import("openclaw/plugin-sdk/channel-message");
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(createBaseOpts()); await new Promise((r) => setTimeout(r, 50));
    vi.mocked(sendDurableMessageBatch).mockClear();
    const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
    if (deliver) await deliver({ text: "Fresh" }, { kind: "final" });
    expect(sendDurableMessageBatch).toHaveBeenCalled();
    blocker.resolve(); await p;
  });

  it("B3: Empty reply = no message", async () => {
    const { deliverWithFinalizableLivePreviewAdapter } = await import("openclaw/plugin-sdk/channel-message");
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(createBaseOpts()); await new Promise((r) => setTimeout(r, 50));
    vi.mocked(deliverWithFinalizableLivePreviewAdapter).mockClear();
    const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
    if (deliver) await deliver({ text: "" }, { kind: "final" });
    expect(deliverWithFinalizableLivePreviewAdapter).not.toHaveBeenCalled();
    blocker.resolve(); await p;
  });

  it("B4: markFinalReplyStarted called on final delivery", async () => {
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(createBaseOpts()); await new Promise((r) => setTimeout(r, 50));
    const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
    if (deliver) await deliver({ text: "Final" }, { kind: "final" });
    expect(mockDraftPreviewController?.markFinalReplyStarted).toHaveBeenCalled();
    blocker.resolve(); await p;
  });

  it("B5: cleanup called in finally block", async () => {
    await dispatchMessage(createBaseOpts());
    expect(mockDraftPreviewController?.cleanup).toHaveBeenCalled();
  });
});

describe("D. Context Injection", () => {
  beforeEach(resetState);

  it("D1: cove.md -> GroupSystemPrompt", async () => {
    vi.mocked(getCoveMd).mockResolvedValue("Be nice.");
    const { runInboundReplyTurn } = await loadInbound();
    const mockDispatch = vi.mocked(runInboundReplyTurn);
    await dispatchMessage(createBaseOpts());
    expect(capturedResolvedTurn?.ctxPayload?.GroupSystemPrompt).toContain("Be nice.");
  });

  it("D2: No cove.md -> no injection", async () => {
    vi.mocked(getCoveMd).mockResolvedValue(null);
    const { runInboundReplyTurn } = await loadInbound();
    await dispatchMessage(createBaseOpts());
    expect(capturedResolvedTurn?.ctxPayload?.GroupSystemPrompt).toBeUndefined();
  });

  it("D3: Thread uses parent cove.md", async () => {
    const opts = createBaseOpts();
    (opts.restClient as unknown as MockRestClient).getChannel.mockResolvedValue({ id: "thread-1", type: 11, parent_id: "parent-ch" });
    await dispatchMessage(opts);
    expect(getCoveMd).toHaveBeenCalledWith(expect.anything(), "parent-ch", expect.anything());
  });

  it("D4: Batched messages merged", async () => {
    const { runInboundReplyTurn } = await loadInbound();
    const opts = createBaseOpts({
      batchedMessages: [createTestMessage({ content: "First", author: { username: "user1" } }), createTestMessage({ content: "Second", author: { username: "user2" } })],
    });
    await dispatchMessage(opts);
    const body = capturedResolvedTurn?.ctxPayload?.BodyForAgent;
    expect(body).toContain("user1: First"); expect(body).toContain("user2: Second");
  });

  it("D5: Image attachments as [image: url]", async () => {
    const { runInboundReplyTurn } = await loadInbound();
    const opts = createBaseOpts({ message: createTestMessage({ attachments: [{ url: "/files/img.png", content_type: "image/png" }] }) });
    await dispatchMessage(opts);
    expect(capturedResolvedTurn?.ctxPayload?.BodyForAgent).toContain("[image: http://localhost:3400/files/img.png]");
  });
});

describe("E. Tool Progress", () => {
  beforeEach(resetState);

  it("E1: Draft preview controller created", async () => {
    await dispatchMessage(createBaseOpts());
    expect(createCoveDraftPreviewController).toHaveBeenCalled();
  });

  it("E2: onPartialReply wired", async () => {
    await dispatchMessage(createBaseOpts());
    expect(capturedDispatcherParams?.replyOptions?.onPartialReply).toBeDefined();
  });

  it("E3: onAssistantMessageStart wired", async () => {
    await dispatchMessage(createBaseOpts());
    expect(capturedDispatcherParams?.replyOptions?.onAssistantMessageStart).toBeDefined();
  });

  it("E4: onCompactionStart wired", async () => {
    await dispatchMessage(createBaseOpts());
    expect(capturedDispatcherParams?.replyOptions?.onCompactionStart).toBeDefined();
  });

  it("E5: Tool callbacks wired", async () => {
    await dispatchMessage(createBaseOpts());
    expect(capturedDispatcherParams?.replyOptions?.onToolStart).toBeDefined();
    expect(capturedDispatcherParams?.replyOptions?.onItemEvent).toBeDefined();
  });

  it("E6: onReasoningStream wired", async () => {
    await dispatchMessage(createBaseOpts());
    expect(capturedDispatcherParams?.replyOptions?.onReasoningStream).toBeDefined();
  });

  it("E7: onReasoningEnd wired", async () => {
    await dispatchMessage(createBaseOpts());
    expect(capturedDispatcherParams?.replyOptions?.onReasoningEnd).toBeDefined();
  });

  it("E8: onToolStart calls pushToolProgress with buildChannelProgressDraftLineForEntry", async () => {
    const { buildChannelProgressDraftLineForEntry } = await import("openclaw/plugin-sdk/channel-message");
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(createBaseOpts()); await new Promise((r) => setTimeout(r, 50));
    vi.mocked(buildChannelProgressDraftLineForEntry).mockClear();
    const onToolStart = capturedDispatcherParams?.replyOptions?.onToolStart;
    if (onToolStart) await onToolStart({ name: "Read", phase: "start", args: { file: "/foo" } });
    expect(buildChannelProgressDraftLineForEntry).toHaveBeenCalled();
    expect(mockDraftPreviewController?.pushToolProgress).toHaveBeenCalled();
    blocker.resolve(); await p;
  });

  it("E9: onItemEvent preamble calls pushCommentaryProgress", async () => {
    const blocker = createDispatchBlocker();
    const opts = createBaseOpts();
    // Enable commentary progress on the mock
    const p = dispatchMessage(opts); await new Promise((r) => setTimeout(r, 50));
    if (mockDraftPreviewController) mockDraftPreviewController.commentaryProgressEnabled = true;
    const onItemEvent = capturedDispatcherParams?.replyOptions?.onItemEvent;
    if (onItemEvent) await onItemEvent({ kind: "preamble", progressText: "Starting...", itemId: "i1" });
    expect(mockDraftPreviewController?.pushCommentaryProgress).toHaveBeenCalledWith("Starting...", { itemId: "i1" });
    blocker.resolve(); await p;
  });
});

describe("F. Lifecycle / Abort", () => {
  beforeEach(resetState);

  it("F1: Typing sent immediately", async () => {
    const opts = createBaseOpts();
    await dispatchMessage(opts);
    expect((opts.restClient as unknown as MockRestClient).sendTyping).toHaveBeenCalledWith("ch-1");
  });

  it("F2: Typing keepalive 5s", async () => {
    await dispatchMessage(createBaseOpts());
    expect(createTypingCallbacks).toHaveBeenCalledWith(expect.objectContaining({ keepaliveIntervalMs: 5000 }));
  });

  it("F3: Typing cleaned on delivery", async () => {
    const mockCleanup = vi.fn();
    vi.mocked(createTypingCallbacks).mockReturnValue({ onReplyStart: vi.fn(async () => {}), onCleanup: mockCleanup });
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(createBaseOpts()); await new Promise((r) => setTimeout(r, 50));
    const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
    if (deliver) await deliver({ text: "Done" }, { kind: "final" });
    expect(mockCleanup).toHaveBeenCalled();
    blocker.resolve(); await p;
  });

  it("F5: Aborted dispatch returns cleanly", async () => {
    const opts = createBaseOpts();
    const { runInboundReplyTurn } = await loadInbound();
    vi.mocked(runInboundReplyTurn).mockImplementationOnce(async () => {
      opts.pendingDispatches.get("ch-1")?.abort(); throw new Error("Aborted");
    });
    await expect(dispatchMessage(opts)).resolves.toBeUndefined();
  });

  it("F6: pendingDispatches cleaned after dispatch", async () => {
    const opts = createBaseOpts();
    await dispatchMessage(opts);
    expect(opts.pendingDispatches.has("ch-1")).toBe(false);
  });

  it("F7: isCurrent() prevents stale updates", async () => {
    const opts = createBaseOpts();
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(opts); await new Promise((r) => setTimeout(r, 50));
    opts.pendingDispatches.clear();
    // Partial reply should not call updateFromPartial when not current
    const onPartialReply = capturedDispatcherParams?.replyOptions?.onPartialReply;
    if (onPartialReply) onPartialReply({ text: "Stale" });
    expect(mockDraftPreviewController?.updateFromPartial).not.toHaveBeenCalled();
    blocker.resolve(); await p;
  });

  it.skip("F4: abort on reconnect (channel.ts, deferred to Phase 1)", () => {
    // Lives in channel.ts startAccount() reconnect handler (L256-262):
    //   for (const controller of pendingDispatches.values()) controller.abort();
    //   pendingDispatches.clear(); messageQueue.clearAll();
    // Testing it standalone requires either (a) instantiating full plugin context
    // with mocked gatewayClient.on('reconnect'), or (b) extracting the handler
    // body into a pure function. Phase 1 (runChannelInboundEvent migration) is
    // the natural place to do (b) since reconnect lifecycle will be touched.
  });
  it.skip("F8: Bot's own messages skipped (channel.ts, requires plugin-context test harness)", () => {
    // channel.ts L344: if (message.author.id === gatewayClient.botUser.id) return;
    // Same as F4 — needs plugin-context harness to test cleanly. Deferred.
  });
});

describe("G. Batched Messages", () => {
  beforeEach(resetState);

  it("G3: Batch = earlier as context + last as primary", async () => {
    const { runInboundReplyTurn } = await loadInbound();
    const earlier = [createTestMessage({ content: "First" }), createTestMessage({ content: "Second" })];
    await dispatchMessage(createBaseOpts({ message: createTestMessage({ content: "Primary" }), batchedMessages: earlier }));
    const body = capturedResolvedTurn?.ctxPayload?.BodyForAgent;
    expect(body).toContain("First"); expect(body).toContain("Primary");
  });

  it.skip("G5: clearAll on reconnect (covered by message-queue.test.ts G5 + F4 deferred above)", () => {});
  it.skip("G1/G2/G4: Queue behaviors — moved to message-queue.test.ts", () => {});
});
