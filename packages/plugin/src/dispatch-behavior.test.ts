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

// Mock the compositor from channel-outbound
let capturedCompositorParams: any = null;
let mockCompositor: any = null;

vi.mock("openclaw/plugin-sdk/channel-outbound", () => {
  return {
    createChannelProgressDraftCompositor: vi.fn((params: any) => {
      capturedCompositorParams = params;
      mockCompositor = {
        previewToolProgressEnabled: true,
        commentaryProgressEnabled: false,
        suppressDefaultToolProgressMessages: true,
        hasStarted: false,
        markFinalReplyStarted: vi.fn(),
        markFinalReplyDelivered: vi.fn(),
        reset: vi.fn(),
        suppress: vi.fn(),
        cancel: vi.fn(),
        start: vi.fn(async () => {}),
        pushToolProgress: vi.fn(async () => true),
        pushReasoningProgress: vi.fn(async () => true),
        pushCommentaryProgress: vi.fn(async () => true),
      };
      return mockCompositor;
    }),
    formatChannelProgressDraftLineForEntry: vi.fn(
      (_entry: any, input: { event: string; name: string }) => `📖 ${input.name}`,
    ),
    formatChannelProgressDraftLine: vi.fn((input: any) => {
      if (input.event === "plan") return `🗺️ ${input.title ?? "plan"}`;
      if (input.event === "approval") return `⚠️ ${input.title ?? "approval"}`;
      if (input.event === "command-output") return `💻 ${input.name ?? "cmd"}`;
      if (input.event === "patch") return `📝 ${input.name ?? "patch"}`;
      return input.title ?? input.event;
    }),
    buildChannelProgressDraftLineForEntry: vi.fn(
      (_entry: any, input: { event: string; title?: string; name?: string }) =>
        `🔔 ${input.title ?? input.name ?? input.event}`,
    ),
  };
});

vi.mock("./cove-md-cache.js", () => ({ getCoveMd: vi.fn() }));

import { dispatchMessage, type DispatchMessageOptions } from "./dispatch.js";
import { createTypingCallbacks, sendDurableMessageBatch } from "openclaw/plugin-sdk/channel-message";
import { createFinalizableDraftLifecycle } from "openclaw/plugin-sdk/channel-lifecycle";
import { getCoveMd } from "./cove-md-cache.js";
import { createChannelProgressDraftCompositor } from "openclaw/plugin-sdk/channel-outbound";

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

const resetState = () => { vi.clearAllMocks(); capturedDispatcherParams = null; capturedSendOrEdit = null; capturedDeleteMessage = null; capturedResolvedTurn = null; dispatchBlocker = null; capturedDraftUpdate = null; capturedDraftSeal = null; capturedCompositorParams = null; mockCompositor = null; };

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

    const opts = createBaseOpts(); const restClient = opts.restClient as unknown as MockRestClient;
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(opts); await new Promise((r) => setTimeout(r, 50));
    restClient.sendMessage.mockClear();
    const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
    if (deliver) await deliver({ text: "Fresh" }, { kind: "final" });
    // Fresh send via sendDurableMessageBatch (not direct restClient.sendMessage)
    expect(sendDurableMessageBatch).toHaveBeenCalledWith(expect.objectContaining({
      channel: "cove",
      to: "ch-1",
      payloads: [{ text: "Fresh" }],
    }));
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

describe("E. Tool Progress (Compositor)", () => {
  beforeEach(resetState);

  it("E1: Compositor created with correct params", async () => {
    await dispatchMessage(createBaseOpts());
    expect(createChannelProgressDraftCompositor).toHaveBeenCalledWith(expect.objectContaining({
      entry: expect.anything(),
      mode: "progress",
      active: true,
      seed: "msg-1",
      update: expect.any(Function),
    }));
  });

  it("E2: onPartialReply not wired in progress mode (matches Discord)", async () => {
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(createBaseOpts());
    await new Promise((r) => setTimeout(r, 50));

    const onPartialReply = capturedDispatcherParams?.replyOptions?.onPartialReply;
    expect(onPartialReply).toBeUndefined();

    blocker.resolve(); await p;
  });

  it("E3: onAssistantMessageStart calls compositor.reset", async () => {
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(createBaseOpts());
    await new Promise((r) => setTimeout(r, 50));

    const onAssistantMessageStart = capturedDispatcherParams?.replyOptions?.onAssistantMessageStart;
    expect(onAssistantMessageStart).toBeDefined();
    onAssistantMessageStart();
    expect(mockCompositor.reset).toHaveBeenCalled();

    blocker.resolve(); await p;
  });

  it("E4: onCompactionStart pushes compaction line", async () => {
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(createBaseOpts());
    await new Promise((r) => setTimeout(r, 50));

    const onCompactionStart = capturedDispatcherParams?.replyOptions?.onCompactionStart;
    expect(onCompactionStart).toBeDefined();
    onCompactionStart();
    expect(mockCompositor.pushToolProgress).toHaveBeenCalledWith(
      "📦 **Compacting context...**",
      { startImmediately: true },
    );

    blocker.resolve(); await p;
  });

  it("E5: onToolStart calls pushToolProgress with formatted line", async () => {
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(createBaseOpts());
    await new Promise((r) => setTimeout(r, 50));

    const onToolStart = capturedDispatcherParams?.replyOptions?.onToolStart;
    expect(onToolStart).toBeDefined();
    onToolStart({ name: "Read", args: { file: "/foo" } });
    expect(mockCompositor.pushToolProgress).toHaveBeenCalledWith("📖 Read", { toolName: "Read" });

    blocker.resolve(); await p;
  });

  it("E6: onItemEvent calls pushToolProgress", async () => {
    const blocker = createDispatchBlocker();
    const p = dispatchMessage(createBaseOpts());
    await new Promise((r) => setTimeout(r, 50));

    const onItemEvent = capturedDispatcherParams?.replyOptions?.onItemEvent;
    expect(onItemEvent).toBeDefined();
    onItemEvent({ title: "Task created", kind: "task" });
    expect(mockCompositor.pushToolProgress).toHaveBeenCalledWith("🔔 Task created");

    blocker.resolve(); await p;
  });

  it("E7: suppressDefaultToolProgressMessages from compositor", async () => {
    await dispatchMessage(createBaseOpts());
    expect(capturedDispatcherParams?.replyOptions?.suppressDefaultToolProgressMessages).toBe(true);
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

  it.skip("F4: abort on reconnect (channel.ts, deferred to Phase 1)", () => {});
  it.skip("F8: Bot's own messages skipped (channel.ts, requires plugin-context test harness)", () => {});
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
    it("H2a: compositor update callback pushes text to draft.update", async () => {
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(createBaseOpts());
      await new Promise((r) => setTimeout(r, 50));

      // The compositor's update callback is captured in capturedCompositorParams
      expect(capturedCompositorParams?.update).toBeDefined();
      await capturedCompositorParams.update("Working on it...\n\n📖 Read file.ts");
      expect(capturedDraftUpdate).toHaveBeenCalledWith("Working on it...\n\n📖 Read file.ts");

      blocker.resolve();
      await p;
    });

    it("H2b: compositor update with flush calls draft.loop.flush", async () => {
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(createBaseOpts());
      await new Promise((r) => setTimeout(r, 50));

      await capturedCompositorParams.update("text", { flush: true });
      expect(capturedDraftUpdate).toHaveBeenCalledWith("text");

      blocker.resolve();
      await p;
    });

    it("H2c: onPartialReply not wired in progress mode (matches Discord)", async () => {
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(createBaseOpts());
      await new Promise((r) => setTimeout(r, 50));

      const onPartialReply = capturedDispatcherParams?.replyOptions?.onPartialReply;
      expect(onPartialReply).toBeUndefined();

      blocker.resolve();
      await p;
    });

    it("H2d: onPartialReply not wired — no-op", async () => {
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(createBaseOpts());
      await new Promise((r) => setTimeout(r, 50));

      // onPartialReply is not wired, so nothing to call
      expect(capturedDraftUpdate).not.toHaveBeenCalled();

      blocker.resolve();
      await p;
    });
  });

  describe("H3. Compaction-period draft behavior", () => {
    it("H3a: onCompactionStart pushes compaction progress", async () => {
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(createBaseOpts());
      await new Promise((r) => setTimeout(r, 50));

      const onCompactionStart = capturedDispatcherParams?.replyOptions?.onCompactionStart;
      expect(onCompactionStart).toBeDefined();
      onCompactionStart();

      expect(mockCompositor.pushToolProgress).toHaveBeenCalledWith(
        "📦 **Compacting context...**",
        { startImmediately: true },
      );

      blocker.resolve();
      await p;
    });

    it("H3b: onCompactionEnd resets compositor", async () => {
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(createBaseOpts());
      await new Promise((r) => setTimeout(r, 50));

      const onCompactionEnd = capturedDispatcherParams?.replyOptions?.onCompactionEnd;
      expect(onCompactionEnd).toBeDefined();
      onCompactionEnd();

      expect(mockCompositor.reset).toHaveBeenCalled();

      blocker.resolve();
      await p;
    });
  });

  describe("H4. Final delivery branching", () => {
    it("H4a: error-stopped draft → fresh send via sendDurableMessageBatch", async () => {

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

      restClient.sendMessage.mockClear();
      const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
      if (deliver) await deliver({ text: "Final text after error" }, { kind: "final" });

      // draftState.stopped is true → should go through freshSend → sendDurableMessageBatch
      expect(sendDurableMessageBatch).toHaveBeenCalledWith(expect.objectContaining({
        channel: "cove",
        payloads: [{ text: "Final text after error" }],
      }));

      blocker.resolve();
      await p;
    });

    it("H4b: final edit-in-place failure → fallback fresh send + orphan cleanup", async () => {

      const opts = createBaseOpts();
      const restClient = opts.restClient as unknown as MockRestClient;

      const blocker = createDispatchBlocker();
      const p = dispatchMessage(opts);
      await new Promise((r) => setTimeout(r, 50));

      // Create a draft successfully
      if (capturedSendOrEdit) await capturedSendOrEdit("Draft content");

      // Make the final edit fail
      restClient.editMessage.mockRejectedValueOnce(new Error("Message deleted"));
      restClient.sendMessage.mockClear();

      const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
      if (deliver) await deliver({ text: "Recovery text" }, { kind: "final" });

      // Should have attempted edit, then fell back to freshSend → sendDurableMessageBatch
      expect(sendDurableMessageBatch).toHaveBeenCalledWith(expect.objectContaining({
        channel: "cove",
        payloads: [{ text: "Recovery text" }],
      }));
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

      expect(mockCompositor.pushToolProgress).not.toHaveBeenCalled();
      expect(mockCompositor.reset).not.toHaveBeenCalled();

      blocker.resolve();
      await p;
    });

    it("H5d: onPartialReply not wired — no guard needed (matches Discord progress mode)", async () => {
      const opts = createBaseOpts();
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(opts);
      await new Promise((r) => setTimeout(r, 50));

      // onPartialReply is not wired in progress mode
      const onPartialReply = capturedDispatcherParams?.replyOptions?.onPartialReply;
      expect(onPartialReply).toBeUndefined();

      blocker.resolve();
      await p;
    });

    it("H5e: onToolStart guarded by isCurrent", async () => {
      const opts = createBaseOpts();
      const blocker = createDispatchBlocker();
      const p = dispatchMessage(opts);
      await new Promise((r) => setTimeout(r, 50));

      // Supersede
      opts.pendingDispatches.set("ch-1", new AbortController());

      const onToolStart = capturedDispatcherParams?.replyOptions?.onToolStart;
      onToolStart({ name: "Read" });

      expect(mockCompositor.pushToolProgress).not.toHaveBeenCalled();

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

      restClient.sendMessage.mockClear();
      restClient.deleteMessage.mockClear();

      const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
      if (deliver) await deliver({ text: "Fresh delivery" }, { kind: "final" });

      // Should have sent via sendDurableMessageBatch, then deleted the orphan draft
      expect(sendDurableMessageBatch).toHaveBeenCalledWith(expect.objectContaining({
        channel: "cove",
        payloads: [{ text: "Fresh delivery" }],
      }));
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

// ---------------------------------------------------------------------------
// Bug #391: Long messages (>4000 chars) — sendDurableMessageBatch chunking
// ---------------------------------------------------------------------------

describe("I. Long Message Chunking (Bug #391)", () => {
  beforeEach(resetState);

  const longText = "x".repeat(5000);

  it("I1: freshSend uses sendDurableMessageBatch instead of restClient.sendMessage", async () => {
    const opts = createBaseOpts();
    const restClient = opts.restClient as unknown as MockRestClient;

    const blocker = createDispatchBlocker();
    const p = dispatchMessage(opts);
    await new Promise((r) => setTimeout(r, 50));

    // Force error-stopped so deliver takes freshSend path
    if (capturedSendOrEdit) {
      await capturedSendOrEdit("Draft");
      restClient.editMessage.mockRejectedValueOnce(new Error("API error"));
      await capturedSendOrEdit("Fail");
    }

    restClient.sendMessage.mockClear();
    const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
    if (deliver) await deliver({ text: longText }, { kind: "final" });

    expect(sendDurableMessageBatch).toHaveBeenCalledWith(expect.objectContaining({
      channel: "cove",
      to: "ch-1",
      payloads: [{ text: longText }],
      bestEffort: true,
      durability: "best_effort",
    }));
    expect(restClient.sendMessage).not.toHaveBeenCalled();

    blocker.resolve();
    await p;
  });

  it("I2: editFinal falls back to freshSend for text exceeding COVE_TEXT_CHUNK_LIMIT", async () => {
    const opts = createBaseOpts();
    const restClient = opts.restClient as unknown as MockRestClient;

    const blocker = createDispatchBlocker();
    const p = dispatchMessage(opts);
    await new Promise((r) => setTimeout(r, 50));

    // Create a draft so deliver goes through edit-in-place path
    if (capturedSendOrEdit) await capturedSendOrEdit("Draft");

    const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
    if (deliver) await deliver({ text: longText }, { kind: "final" });

    expect(sendDurableMessageBatch).toHaveBeenCalledWith(expect.objectContaining({
      channel: "cove",
      to: "ch-1",
      payloads: [{ text: longText }],
    }));

    blocker.resolve();
    await p;
  });

  it("I3: preview truncated to COVE_TEXT_CHUNK_LIMIT during streaming", async () => {
    const opts = createBaseOpts();
    const restClient = opts.restClient as unknown as MockRestClient;

    const blocker = createDispatchBlocker();
    const p = dispatchMessage(opts);
    await new Promise((r) => setTimeout(r, 50));

    if (capturedSendOrEdit) await capturedSendOrEdit(longText);

    const sentText = restClient.sendMessage.mock.calls[0]?.[1] as string;
    expect(sentText.length).toBe(4000);
    expect(sentText.endsWith("…")).toBe(true);

    blocker.resolve();
    await p;
  });

  it("I4: text at exactly COVE_TEXT_CHUNK_LIMIT is NOT truncated", async () => {
    const opts = createBaseOpts();
    const restClient = opts.restClient as unknown as MockRestClient;
    const exactText = "y".repeat(4000);

    const blocker = createDispatchBlocker();
    const p = dispatchMessage(opts);
    await new Promise((r) => setTimeout(r, 50));

    if (capturedSendOrEdit) await capturedSendOrEdit(exactText);

    const sentText = restClient.sendMessage.mock.calls[0]?.[1] as string;
    expect(sentText).toBe(exactText);

    blocker.resolve();
    await p;
  });

  it("I5: short text in editFinal uses editMessage directly", async () => {
    const opts = createBaseOpts();
    const restClient = opts.restClient as unknown as MockRestClient;
    const shortText = "Short final reply";

    const blocker = createDispatchBlocker();
    const p = dispatchMessage(opts);
    await new Promise((r) => setTimeout(r, 50));

    if (capturedSendOrEdit) await capturedSendOrEdit("Draft");

    const deliver = capturedDispatcherParams?.dispatcherOptions?.deliver;
    if (deliver) await deliver({ text: shortText }, { kind: "final" });

    expect(restClient.editMessage).toHaveBeenCalledWith("ch-1", "msg-draft-1", shortText);
    expect(sendDurableMessageBatch).not.toHaveBeenCalled();

    blocker.resolve();
    await p;
  });
});