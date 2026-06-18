/**
 * Behavioral contract tests for dispatch.ts
 * Tests behavior contracts from SPEC-398.md Section 2 + SPEC-401.md Phase 0.
 * Groups: A (Draft Streaming), B (Final Delivery), D (Context),
 *         E (Tool Progress), F (Lifecycle), G (Batched),
 *         H (Draft Lifecycle — SPEC-401)
 * Note: Group C skipped — not on main branch.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

let capturedDispatcherParams: any = null;
let capturedSendOrEdit: ((text: string) => Promise<boolean>) | null = null;
let capturedDeleteMessage: ((id?: string) => Promise<void>) | null = null;
let capturedResolvedTurn: any = null;
let dispatchBlocker: { resolve: () => void; promise: Promise<void> } | null = null;
let capturedDraftUpdate: Mock | null = null;
let capturedDraftSeal: Mock | null = null;

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

vi.mock("openclaw/plugin-sdk/channel-message", async () => {
  const real = await vi.importActual<typeof import("openclaw/plugin-sdk/channel-message")>("openclaw/plugin-sdk/channel-message");
  return {
    createTypingCallbacks: vi.fn(() => ({ onReplyStart: vi.fn(async () => {}), onCleanup: vi.fn() })),
    sendDurableMessageBatch: vi.fn(async () => ({ status: "sent", outcomes: [] })),
    deliverWithFinalizableLivePreviewAdapter: real.deliverWithFinalizableLivePreviewAdapter,
    defineFinalizableLivePreviewAdapter: real.defineFinalizableLivePreviewAdapter,
  };
});

vi.mock("openclaw/plugin-sdk/channel-lifecycle", () => ({
  createFinalizableDraftLifecycle: vi.fn((opts: any) => {
    capturedSendOrEdit = opts.sendOrEditStreamMessage;
    capturedDeleteMessage = opts.deleteMessage;
    const update = vi.fn();
    const seal = vi.fn(async () => {});
    const discardPending = vi.fn(async () => {});
    const clear = vi.fn(async () => {});
    const loop = { flush: vi.fn(async () => {}) };
    capturedDraftUpdate = update;
    capturedDraftSeal = seal;
    return { update, seal, discardPending, clear, loop };
  }),
}));

vi.mock("./cove-md-cache.js", () => ({ getCoveMd: vi.fn() }));
vi.mock("./tool-progress.js", () => ({
  createToolProgressTracker: vi.fn(() => ({
    getCombinedText: vi.fn(() => ""), onPartialReply: vi.fn(), onToolStart: vi.fn(),
    onItemEvent: vi.fn(), onPlanUpdate: vi.fn(), onApprovalEvent: vi.fn(),
    onCommandOutput: vi.fn(), onPatchSummary: vi.fn(), onCompactionStart: vi.fn(),
    onCompactionEnd: vi.fn(), onAssistantMessageStart: vi.fn(),
  })),
}));

import { dispatchMessage, type DispatchMessageOptions } from "./dispatch.js";
import { createTypingCallbacks } from "openclaw/plugin-sdk/channel-message";
import { createFinalizableDraftLifecycle } from "openclaw/plugin-sdk/channel-lifecycle";
import { getCoveMd } from "./cove-md-cache.js";
import { createToolProgressTracker } from "./tool-progress.js";

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

const resetState = () => { vi.clearAllMocks(); capturedDispatcherParams = null; capturedSendOrEdit = null; capturedDeleteMessage = null; capturedResolvedTurn = null; dispatchBlocker = null; capturedDraftUpdate = null; capturedDraftSeal = null; };

describe("A. Draft Streaming Lifecycle", () => {
  beforeEach(resetState);

  it("A1: First partial creates POST", async () => {
    const opts = createBaseOpts(); const restClient = opts.restClient as unknown as MockRestClient;
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(opts); await new Promise((r) => setTimeout(r, 50));
    if (capturedSendOrEdit) await capturedSendOrEdit("First partial");
    expect(restClient.sendMessage).toHaveBeenCalledWith("ch-1", "First partial");
    blocker.resolve(); await p;
  });

  it("A2: Subsequent partials PATCH", async () => {
    const opts = createBaseOpts(); const restClient = opts.restClient as unknown as MockRestClient;
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(opts); await new Promise((r) => setTimeout(r, 50));
    if (capturedSendOrEdit) { await capturedSendOrEdit("First"); await capturedSendOrEdit("Updated"); }
    expect(restClient.editMessage).toHaveBeenCalledWith("ch-1", "msg-draft-1", "Updated");
    blocker.resolve(); await p;
  });

  it("A3: Edits sequential (editQueue)", async () => {
    const opts = createBaseOpts(); const restClient = opts.restClient as unknown as MockRestClient;
    const callOrder: string[] = [];
    restClient.sendMessage.mockImplementation(async () => { callOrder.push("send"); return { id: "msg-draft-1" }; });
    restClient.editMessage.mockImplementation(async () => { callOrder.push("edit"); return { id: "msg-draft-1" }; });
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(opts); await new Promise((r) => setTimeout(r, 50));
    if (capturedSendOrEdit) { await capturedSendOrEdit("First"); await capturedSendOrEdit("E1"); await capturedSendOrEdit("E2"); }
    expect(callOrder).toEqual(["send", "edit", "edit"]);
    blocker.resolve(); await p;
  });

  it("A4: Throttled at 250ms", async () => {
    await dispatchMessage(createBaseOpts());
    expect(createFinalizableDraftLifecycle).toHaveBeenCalledWith(expect.objectContaining({ throttleMs: 250 }));
  });

  it("A5: Duplicate text suppressed", async () => {
    const opts = createBaseOpts(); const restClient = opts.restClient as unknown as MockRestClient;
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(opts); await new Promise((r) => setTimeout(r, 50));
    if (capturedSendOrEdit) { await capturedSendOrEdit("Same"); await capturedSendOrEdit("Same"); }
    expect(restClient.sendMessage).toHaveBeenCalledTimes(1);
    expect(restClient.editMessage).not.toHaveBeenCalled();
    blocker.resolve(); await p;
  });

  it("A6: Draft stops on error", async () => {
    const opts = createBaseOpts(); const restClient = opts.restClient as unknown as MockRestClient;
    restClient.editMessage.mockRejectedValueOnce(new Error("Network error"));
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(opts); await new Promise((r) => setTimeout(r, 50));
    if (capturedSendOrEdit) { await capturedSendOrEdit("First"); await capturedSendOrEdit("Fail"); const r = await capturedSendOrEdit("After"); expect(r).toBe(false); }
    blocker.resolve(); await p;
  });

  it("A7: Seal flushes pending", async () => {
    await dispatchMessage(createBaseOpts());
    expect(createFinalizableDraftLifecycle).toHaveBeenCalled();
  });
});

describe("B. Final Delivery", () => {
  beforeEach(resetState);

  it("B1: Final edit when draft active", async () => {
    const opts = createBaseOpts(); const restClient = opts.restClient as unknown as MockRestClient;
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(opts); await new Promise((r) => setTimeout(r, 50));
    if (capturedSendOrEdit) await capturedSendOrEdit("Draft");
    const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
    if (deliver) await deliver({ text: "Final" }, { kind: "final" });
    expect(restClient.editMessage).toHaveBeenCalledWith("ch-1", "msg-draft-1", "Final");
    blocker.resolve(); await p;
  });

  it("B2: Fallback on final edit failure", async () => {
    const opts = createBaseOpts(); const restClient = opts.restClient as unknown as MockRestClient;
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(opts); await new Promise((r) => setTimeout(r, 50));
    if (capturedSendOrEdit) await capturedSendOrEdit("Draft");
    restClient.editMessage.mockRejectedValueOnce(new Error("Edit failed"));
    const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
    if (deliver) await deliver({ text: "Fallback" }, { kind: "final" });
    expect(restClient.deleteMessage).toHaveBeenCalled();
    blocker.resolve(); await p;
  });

  it("B3: Fresh send when no draft", async () => {
    const { sendDurableMessageBatch } = await import("openclaw/plugin-sdk/channel-message");
    const opts = createBaseOpts(); const restClient = opts.restClient as unknown as MockRestClient;
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(opts); await new Promise((r) => setTimeout(r, 50));
    vi.mocked(sendDurableMessageBatch).mockClear();
    const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
    if (deliver) await deliver({ text: "Fresh" }, { kind: "final" });
    // Phase 2: fresh send now goes through sendDurableMessageBatch (gets chunking)
    expect(sendDurableMessageBatch).toHaveBeenCalled();
    blocker.resolve(); await p;
  });

  it("B4: Draft deleted on cleanup", async () => {
    const opts = createBaseOpts(); const restClient = opts.restClient as unknown as MockRestClient;
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(opts); await new Promise((r) => setTimeout(r, 50));
    if (capturedDeleteMessage) await capturedDeleteMessage("msg-orphan");
    expect(restClient.deleteMessage).toHaveBeenCalledWith("ch-1", "msg-orphan");
    blocker.resolve(); await p;
  });

  it("B5: Empty reply = no message", async () => {
    const opts = createBaseOpts(); const restClient = opts.restClient as unknown as MockRestClient;
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(opts); await new Promise((r) => setTimeout(r, 50));
    const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
    if (deliver) await deliver({ text: "" }, { kind: "final" });
    expect(restClient.editMessage).not.toHaveBeenCalled();
    blocker.resolve(); await p;
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

  it("E1: Progress lines rendered", async () => {
    await dispatchMessage(createBaseOpts());
    expect(createToolProgressTracker).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ onProgressUpdate: expect.any(Function) }));
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
    if (capturedSendOrEdit) expect(await capturedSendOrEdit("Stale")).toBe(false);
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

// ---------------------------------------------------------------------------
// SPEC-401 Phase 0: Draft Streaming Lifecycle behavioral tests
// ---------------------------------------------------------------------------

describe("H. Draft Streaming Lifecycle (SPEC-401)", () => {
  beforeEach(resetState);

  describe("H1. Full lifecycle flow: create → edit → seal → final", () => {
    it("H1a: draft create → stream edits → seal → final edit-in-place", async () => {
      const opts = createBaseOpts();
      const restClient = opts.restClient as unknown as MockRestClient;
      const callOrder: string[] = [];
      restClient.sendMessage.mockImplementation(async () => { callOrder.push("send"); return { id: "msg-draft-1" }; });
      restClient.editMessage.mockImplementation(async () => { callOrder.push("edit"); return { id: "msg-draft-1" }; });

      const blocker = createDispatchBlocker();
      const p = dispatchMessage(opts);
      await new Promise((r) => setTimeout(r, 50));

      // Phase 1: create draft
      if (capturedSendOrEdit) await capturedSendOrEdit("Thinking...");
      expect(restClient.sendMessage).toHaveBeenCalledWith("ch-1", "Thinking...");

      // Phase 2: stream edits
      if (capturedSendOrEdit) await capturedSendOrEdit("Thinking... Let me");
      if (capturedSendOrEdit) await capturedSendOrEdit("Thinking... Let me check");
      expect(restClient.editMessage).toHaveBeenCalledTimes(2);

      // Phase 3: final delivery edits in place
      const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
      if (deliver) await deliver({ text: "Here is the answer." }, { kind: "final" });
      expect(capturedDraftSeal).toHaveBeenCalled();
      // Last editMessage call is the final edit-in-place
      expect(restClient.editMessage).toHaveBeenLastCalledWith("ch-1", "msg-draft-1", "Here is the answer.");

      expect(callOrder).toEqual(["send", "edit", "edit", "edit"]);
      blocker.resolve();
      await p;
    });

    it("H1b: no draft created when first partial is empty", async () => {
      const opts = createBaseOpts();
      const restClient = opts.restClient as unknown as MockRestClient;
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(opts);
      await new Promise((r) => setTimeout(r, 50));

      if (capturedSendOrEdit) {
        const r1 = await capturedSendOrEdit("");
        const r2 = await capturedSendOrEdit("   ");
        expect(r1).toBe(false);
        expect(r2).toBe(false);
      }
      expect(restClient.sendMessage).not.toHaveBeenCalled();
      expect(restClient.editMessage).not.toHaveBeenCalled();

      blocker.resolve();
      await p;
    });
  });

  describe("H2. Tool progress injection into draft", () => {
    it("H2a: onProgressUpdate pushes combined text to draft.update", async () => {
      // Set up a tracker mock that captures onProgressUpdate and returns combined text
      let capturedOnProgressUpdate: (() => void) | undefined;
      const mockTracker = {
        getCombinedText: vi.fn(() => "Working on it...\n\n📖 Read file.ts"),
        onPartialReply: vi.fn(), onToolStart: vi.fn(), onItemEvent: vi.fn(),
        onPlanUpdate: vi.fn(), onApprovalEvent: vi.fn(), onCommandOutput: vi.fn(),
        onPatchSummary: vi.fn(), onCompactionStart: vi.fn(), onCompactionEnd: vi.fn(),
        onAssistantMessageStart: vi.fn(),
        gate: { hasStarted: false, workEvents: 0, noteWork: vi.fn(), startNow: vi.fn(), cancel: vi.fn() },
      };
      vi.mocked(createToolProgressTracker).mockImplementationOnce((_cfg, opts) => {
        capturedOnProgressUpdate = opts?.onProgressUpdate;
        return mockTracker;
      });

      const blocker = createDispatchBlocker();
      const p = dispatchMessage(createBaseOpts());
      await new Promise((r) => setTimeout(r, 50));

      // Simulate a progress update
      expect(capturedOnProgressUpdate).toBeDefined();
      capturedOnProgressUpdate!();
      expect(capturedDraftUpdate).toHaveBeenCalledWith("Working on it...\n\n📖 Read file.ts");

      blocker.resolve();
      await p;
    });

    it("H2b: onProgressUpdate skips draft.update when combined text is empty", async () => {
      let capturedOnProgressUpdate: (() => void) | undefined;
      const mockTracker = {
        getCombinedText: vi.fn(() => ""),
        onPartialReply: vi.fn(), onToolStart: vi.fn(), onItemEvent: vi.fn(),
        onPlanUpdate: vi.fn(), onApprovalEvent: vi.fn(), onCommandOutput: vi.fn(),
        onPatchSummary: vi.fn(), onCompactionStart: vi.fn(), onCompactionEnd: vi.fn(),
        onAssistantMessageStart: vi.fn(),
        gate: { hasStarted: false, workEvents: 0, noteWork: vi.fn(), startNow: vi.fn(), cancel: vi.fn() },
      };
      vi.mocked(createToolProgressTracker).mockImplementationOnce((_cfg, opts) => {
        capturedOnProgressUpdate = opts?.onProgressUpdate;
        return mockTracker;
      });

      const blocker = createDispatchBlocker();
      const p = dispatchMessage(createBaseOpts());
      await new Promise((r) => setTimeout(r, 50));

      capturedOnProgressUpdate!();
      expect(capturedDraftUpdate).not.toHaveBeenCalled();

      blocker.resolve();
      await p;
    });

    it("H2c: onPartialReply forwards to both tracker and draft.update", async () => {
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(createBaseOpts());
      await new Promise((r) => setTimeout(r, 50));

      const onPartialReply = capturedDispatcherParams?.replyOptions?.onPartialReply;
      expect(onPartialReply).toBeDefined();
      onPartialReply({ text: "Hello from the agent" });

      const tracker = vi.mocked(createToolProgressTracker).mock.results[0]?.value;
      expect(tracker.onPartialReply).toHaveBeenCalledWith("Hello from the agent");
      expect(capturedDraftUpdate).toHaveBeenCalledWith("Hello from the agent");

      blocker.resolve();
      await p;
    });

    it("H2d: onPartialReply with empty text is ignored", async () => {
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(createBaseOpts());
      await new Promise((r) => setTimeout(r, 50));

      const onPartialReply = capturedDispatcherParams?.replyOptions?.onPartialReply;
      onPartialReply({ text: "" });
      onPartialReply(null);
      onPartialReply({});

      expect(capturedDraftUpdate).not.toHaveBeenCalled();

      blocker.resolve();
      await p;
    });
  });

  describe("H3. Compaction-period draft behavior", () => {
    it("H3a: onCompactionStart pushes combined text to draft", async () => {
      let capturedOnProgressUpdate: (() => void) | undefined;
      const mockTracker = {
        getCombinedText: vi.fn(() => "📦 **Compacting context...**"),
        onPartialReply: vi.fn(), onToolStart: vi.fn(), onItemEvent: vi.fn(),
        onPlanUpdate: vi.fn(), onApprovalEvent: vi.fn(), onCommandOutput: vi.fn(),
        onPatchSummary: vi.fn(),
        onCompactionStart: vi.fn(), onCompactionEnd: vi.fn(),
        onAssistantMessageStart: vi.fn(),
        gate: { hasStarted: false, workEvents: 0, noteWork: vi.fn(), startNow: vi.fn(), cancel: vi.fn() },
      };
      vi.mocked(createToolProgressTracker).mockImplementationOnce((_cfg, opts) => {
        capturedOnProgressUpdate = opts?.onProgressUpdate;
        return mockTracker;
      });

      const blocker = createDispatchBlocker();
      const p = dispatchMessage(createBaseOpts());
      await new Promise((r) => setTimeout(r, 50));

      const onCompactionStart = capturedDispatcherParams?.replyOptions?.onCompactionStart;
      expect(onCompactionStart).toBeDefined();
      onCompactionStart();

      expect(mockTracker.onCompactionStart).toHaveBeenCalled();
      expect(capturedDraftUpdate).toHaveBeenCalledWith("📦 **Compacting context...**");

      blocker.resolve();
      await p;
    });

    it("H3b: onCompactionEnd forwards to tracker (clears compaction state)", async () => {
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(createBaseOpts());
      await new Promise((r) => setTimeout(r, 50));

      const onCompactionEnd = capturedDispatcherParams?.replyOptions?.onCompactionEnd;
      expect(onCompactionEnd).toBeDefined();
      onCompactionEnd();

      const tracker = vi.mocked(createToolProgressTracker).mock.results[0]?.value;
      expect(tracker.onCompactionEnd).toHaveBeenCalled();

      blocker.resolve();
      await p;
    });
  });

  describe("H4. Final delivery branching", () => {
    it("H4a: error-stopped draft → fresh send via sendDurableMessageBatch", async () => {
      const { sendDurableMessageBatch } = await import("openclaw/plugin-sdk/channel-message");
      const opts = createBaseOpts();
      const restClient = opts.restClient as unknown as MockRestClient;
      restClient.editMessage.mockRejectedValueOnce(new Error("Network error"));

      const blocker = createDispatchBlocker();
      const p = dispatchMessage(opts);
      await new Promise((r) => setTimeout(r, 50));

      // Create a draft, then cause a streaming error
      if (capturedSendOrEdit) {
        await capturedSendOrEdit("First partial");
        await capturedSendOrEdit("This will fail");
      }

      vi.mocked(sendDurableMessageBatch).mockClear();
      const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
      if (deliver) await deliver({ text: "Final text after error" }, { kind: "final" });

      // draftState.stopped is true → should go through freshSend, not edit-in-place
      expect(sendDurableMessageBatch).toHaveBeenCalled();

      blocker.resolve();
      await p;
    });

    it("H4b: final edit-in-place failure → fallback fresh send + orphan cleanup", async () => {
      const { sendDurableMessageBatch } = await import("openclaw/plugin-sdk/channel-message");
      const opts = createBaseOpts();
      const restClient = opts.restClient as unknown as MockRestClient;

      const blocker = createDispatchBlocker();
      const p = dispatchMessage(opts);
      await new Promise((r) => setTimeout(r, 50));

      // Create a draft successfully
      if (capturedSendOrEdit) await capturedSendOrEdit("Draft content");

      // Make the final edit fail
      restClient.editMessage.mockRejectedValueOnce(new Error("Message deleted"));
      vi.mocked(sendDurableMessageBatch).mockClear();

      const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
      if (deliver) await deliver({ text: "Recovery text" }, { kind: "final" });

      // Should have attempted edit, then fell back to fresh send
      expect(sendDurableMessageBatch).toHaveBeenCalled();
      // Orphan draft should be cleaned up
      expect(restClient.deleteMessage).toHaveBeenCalledWith("ch-1", "msg-draft-1");

      blocker.resolve();
      await p;
    });

    it("H4c: seal() is called before final delivery", async () => {
      const opts = createBaseOpts();
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(opts);
      await new Promise((r) => setTimeout(r, 50));

      if (capturedSendOrEdit) await capturedSendOrEdit("Draft");

      const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
      if (deliver) await deliver({ text: "Final" }, { kind: "final" });

      expect(capturedDraftSeal).toHaveBeenCalled();

      blocker.resolve();
      await p;
    });

    it("H4d: typing cleanup happens before final delivery", async () => {
      const cleanupCalls: string[] = [];
      const mockCleanup = vi.fn(() => cleanupCalls.push("cleanup"));
      vi.mocked(createTypingCallbacks).mockReturnValue({ onReplyStart: vi.fn(async () => {}), onCleanup: mockCleanup });

      const opts = createBaseOpts();
      const restClient = opts.restClient as unknown as MockRestClient;
      restClient.editMessage.mockImplementation(async () => {
        // When editMessage is called, cleanup should have already happened
        expect(cleanupCalls).toEqual(["cleanup"]);
        return { id: "msg-draft-1" };
      });

      const blocker = createDispatchBlocker();
      const p = dispatchMessage(opts);
      await new Promise((r) => setTimeout(r, 50));

      if (capturedSendOrEdit) await capturedSendOrEdit("Draft");
      const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
      if (deliver) await deliver({ text: "Final" }, { kind: "final" });

      expect(mockCleanup).toHaveBeenCalled();

      blocker.resolve();
      await p;
    });
  });

  describe("H5. Abort mid-draft", () => {
    it("H5a: stale dispatch mid-stream → sendOrEdit returns false", async () => {
      const opts = createBaseOpts();
      const restClient = opts.restClient as unknown as MockRestClient;
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(opts);
      await new Promise((r) => setTimeout(r, 50));

      // Create a draft
      if (capturedSendOrEdit) await capturedSendOrEdit("Draft started");
      expect(restClient.sendMessage).toHaveBeenCalledTimes(1);

      // Simulate supersession: new dispatch for same channel replaces the abort controller
      opts.pendingDispatches.set("ch-1", new AbortController());

      // Further edits should be rejected
      if (capturedSendOrEdit) {
        const r = await capturedSendOrEdit("This should not land");
        expect(r).toBe(false);
      }
      expect(restClient.editMessage).not.toHaveBeenCalled();

      blocker.resolve();
      await p;
    });

    it("H5b: stale dispatch → deliver() is a no-op", async () => {
      const opts = createBaseOpts();
      const restClient = opts.restClient as unknown as MockRestClient;
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(opts);
      await new Promise((r) => setTimeout(r, 50));

      if (capturedSendOrEdit) await capturedSendOrEdit("Draft");

      // Supersede
      opts.pendingDispatches.set("ch-1", new AbortController());

      const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
      if (deliver) await deliver({ text: "Should not deliver" }, { kind: "final" });

      // Only the initial send from the draft, no final edit
      expect(restClient.editMessage).not.toHaveBeenCalled();

      blocker.resolve();
      await p;
    });

    it("H5c: guardFwd blocks event forwarding on stale dispatch", async () => {
      const opts = createBaseOpts();
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(opts);
      await new Promise((r) => setTimeout(r, 50));

      const tracker = vi.mocked(createToolProgressTracker).mock.results[0]?.value;

      // Supersede
      opts.pendingDispatches.set("ch-1", new AbortController());

      // All guarded callbacks should be no-ops
      const replyOpts = capturedDispatcherParams?.replyOptions;
      replyOpts?.onItemEvent?.({ title: "stale" });
      replyOpts?.onPlanUpdate?.({ phase: "update", title: "stale" });
      replyOpts?.onApprovalEvent?.({ phase: "requested", title: "stale" });
      replyOpts?.onCommandOutput?.({ phase: "end", name: "stale" });
      replyOpts?.onPatchSummary?.({ phase: "end", name: "stale" });
      replyOpts?.onCompactionStart?.();
      replyOpts?.onCompactionEnd?.();
      replyOpts?.onAssistantMessageStart?.();

      expect(tracker.onItemEvent).not.toHaveBeenCalled();
      expect(tracker.onPlanUpdate).not.toHaveBeenCalled();
      expect(tracker.onApprovalEvent).not.toHaveBeenCalled();
      expect(tracker.onCommandOutput).not.toHaveBeenCalled();
      expect(tracker.onPatchSummary).not.toHaveBeenCalled();
      expect(tracker.onCompactionStart).not.toHaveBeenCalled();
      expect(tracker.onCompactionEnd).not.toHaveBeenCalled();
      expect(tracker.onAssistantMessageStart).not.toHaveBeenCalled();

      blocker.resolve();
      await p;
    });

    it("H5d: onPartialReply also guarded by isCurrent", async () => {
      const opts = createBaseOpts();
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(opts);
      await new Promise((r) => setTimeout(r, 50));

      // Supersede
      opts.pendingDispatches.set("ch-1", new AbortController());

      const onPartialReply = capturedDispatcherParams?.replyOptions?.onPartialReply;
      onPartialReply({ text: "Stale partial" });

      // draft.update should not have been called
      expect(capturedDraftUpdate).not.toHaveBeenCalled();

      blocker.resolve();
      await p;
    });

    it("H5e: onToolStart guarded by isCurrent", async () => {
      const opts = createBaseOpts();
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(opts);
      await new Promise((r) => setTimeout(r, 50));

      const tracker = vi.mocked(createToolProgressTracker).mock.results[0]?.value;

      // Supersede
      opts.pendingDispatches.set("ch-1", new AbortController());

      const onToolStart = capturedDispatcherParams?.replyOptions?.onToolStart;
      onToolStart({ name: "Read" });

      expect(tracker.onToolStart).not.toHaveBeenCalled();

      blocker.resolve();
      await p;
    });
  });

  describe("H6. Draft deletion semantics", () => {
    it("H6a: deleteMessage callback uses channelId from dispatch context", async () => {
      const opts = createBaseOpts();
      const restClient = opts.restClient as unknown as MockRestClient;
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(opts);
      await new Promise((r) => setTimeout(r, 50));

      if (capturedDeleteMessage) await capturedDeleteMessage("msg-to-delete");
      expect(restClient.deleteMessage).toHaveBeenCalledWith("ch-1", "msg-to-delete");

      blocker.resolve();
      await p;
    });

    it("H6b: deleteMessage failure is caught and warns (best-effort)", async () => {
      const opts = createBaseOpts();
      const restClient = opts.restClient as unknown as MockRestClient;
      restClient.deleteMessage.mockRejectedValueOnce(new Error("404 Not Found"));

      const blocker = createDispatchBlocker();
      const p = dispatchMessage(opts);
      await new Promise((r) => setTimeout(r, 50));

      // Should not throw
      if (capturedDeleteMessage) await capturedDeleteMessage("ghost-msg");
      expect(opts.log?.warn).toHaveBeenCalledWith(expect.stringContaining("ghost-msg"));

      blocker.resolve();
      await p;
    });

    it("H6c: freshSend cleans up orphan draft after successful send", async () => {
      const { sendDurableMessageBatch } = await import("openclaw/plugin-sdk/channel-message");
      const opts = createBaseOpts();
      const restClient = opts.restClient as unknown as MockRestClient;

      const blocker = createDispatchBlocker();
      const p = dispatchMessage(opts);
      await new Promise((r) => setTimeout(r, 50));

      // Create a draft
      if (capturedSendOrEdit) await capturedSendOrEdit("Orphan draft");

      // Force error-stopped so deliver takes freshSend path
      if (capturedSendOrEdit) {
        restClient.editMessage.mockRejectedValueOnce(new Error("API error"));
        await capturedSendOrEdit("Fail edit");
      }

      vi.mocked(sendDurableMessageBatch).mockClear();
      restClient.deleteMessage.mockClear();

      const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
      if (deliver) await deliver({ text: "Fresh delivery" }, { kind: "final" });

      // Should have sent via batch, then deleted the orphan draft
      expect(sendDurableMessageBatch).toHaveBeenCalled();
      expect(restClient.deleteMessage).toHaveBeenCalledWith("ch-1", "msg-draft-1");

      blocker.resolve();
      await p;
    });
  });

  describe("H7. Trailing whitespace trimming in sendOrEdit", () => {
    it("H7a: trailing whitespace/newlines trimmed before send", async () => {
      const opts = createBaseOpts();
      const restClient = opts.restClient as unknown as MockRestClient;
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(opts);
      await new Promise((r) => setTimeout(r, 50));

      if (capturedSendOrEdit) await capturedSendOrEdit("Hello   \n\n");
      expect(restClient.sendMessage).toHaveBeenCalledWith("ch-1", "Hello");

      blocker.resolve();
      await p;
    });

    it("H7b: whitespace-only text treated as empty (not sent)", async () => {
      const opts = createBaseOpts();
      const restClient = opts.restClient as unknown as MockRestClient;
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(opts);
      await new Promise((r) => setTimeout(r, 50));

      if (capturedSendOrEdit) {
        const r = await capturedSendOrEdit("   \n\t  ");
        expect(r).toBe(false);
      }
      expect(restClient.sendMessage).not.toHaveBeenCalled();

      blocker.resolve();
      await p;
    });

    it("H7c: dedup uses trimmed text (pre- and post-trim identical → suppressed)", async () => {
      const opts = createBaseOpts();
      const restClient = opts.restClient as unknown as MockRestClient;
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(opts);
      await new Promise((r) => setTimeout(r, 50));

      if (capturedSendOrEdit) {
        await capturedSendOrEdit("Same");
        await capturedSendOrEdit("Same   ");  // trailing whitespace → trims to "Same"
      }
      expect(restClient.sendMessage).toHaveBeenCalledTimes(1);
      expect(restClient.editMessage).not.toHaveBeenCalled();

      blocker.resolve();
      await p;
    });
  });
});
