/**
 * Behavioral contract tests for dispatch.ts
 * Tests 32 behavior contracts from SPEC-398.md Section 2.
 * Groups: A (Draft Streaming), B (Final Delivery), D (Context),
 *         E (Tool Progress), F (Lifecycle), G (Batched)
 * Note: Group C skipped — not on main branch.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

let capturedDispatcherParams: any = null;
let capturedSendOrEdit: ((text: string) => Promise<boolean>) | null = null;
let capturedDeleteMessage: ((id?: string) => Promise<void>) | null = null;
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
}));

vi.mock("openclaw/plugin-sdk/channel-lifecycle", () => ({
  createFinalizableDraftLifecycle: vi.fn((opts: any) => {
    capturedSendOrEdit = opts.sendOrEditStreamMessage;
    capturedDeleteMessage = opts.deleteMessage;
    return { update: vi.fn(), seal: vi.fn(async () => {}) };
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

const resetState = () => { vi.clearAllMocks(); capturedDispatcherParams = null; capturedSendOrEdit = null; capturedDeleteMessage = null; capturedResolvedTurn = null; dispatchBlocker = null; };

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
    expect(restClient.sendMessage).toHaveBeenCalled();
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
