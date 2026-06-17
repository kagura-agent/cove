import { describe, it, expect, vi } from "vitest";

/**
 * Unit tests for the editQueue serialization pattern used in channel.ts.
 *
 * The editQueue ensures that overlapping sendOrEdit calls land in sequential
 * order, which is critical for streaming preview correctness.  The pattern
 * under test is extracted here to keep tests focused without importing the
 * full channel plugin runtime.
 */

interface DraftState {
  stopped: boolean;
  final: boolean;
}

/** Minimal reproduction of the sendOrEdit + editQueue pattern from channel.ts */
function createEditQueue(opts: {
  editMessage: (text: string) => Promise<void>;
  sendMessage: (text: string) => Promise<{ id: string }>;
}) {
  const draftState: DraftState = { stopped: false, final: false };
  let draftMessageId: string | undefined;
  let lastSentText = "";
  let editQueue = Promise.resolve();

  const sendOrEdit = async (text: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      editQueue = editQueue.then(async () => {
        if (draftState.stopped && !draftState.final) {
          resolve(false);
          return;
        }
        const trimmed = text.trimEnd();
        if (!trimmed || trimmed === lastSentText) {
          resolve(false);
          return;
        }
        lastSentText = trimmed;
        try {
          if (draftMessageId) {
            await opts.editMessage(trimmed);
          } else {
            const msg = await opts.sendMessage(trimmed);
            draftMessageId = msg.id;
          }
          resolve(true);
        } catch {
          draftState.stopped = true;
          resolve(false);
        }
      });
    });
  };

  return { sendOrEdit, draftState, getDraftMessageId: () => draftMessageId };
}

describe("editQueue serialization", () => {
  it("sends first message, then edits subsequent calls", async () => {
    const calls: string[] = [];
    const queue = createEditQueue({
      sendMessage: async (text) => {
        calls.push(`send:${text}`);
        return { id: "msg-1" };
      },
      editMessage: async (text) => {
        calls.push(`edit:${text}`);
      },
    });

    await queue.sendOrEdit("Hello");
    await queue.sendOrEdit("Hello world");
    await queue.sendOrEdit("Hello world!");

    expect(calls).toEqual(["send:Hello", "edit:Hello world", "edit:Hello world!"]);
  });

  it("deduplicates identical text", async () => {
    const calls: string[] = [];
    const queue = createEditQueue({
      sendMessage: async (text) => {
        calls.push(`send:${text}`);
        return { id: "msg-1" };
      },
      editMessage: async (text) => {
        calls.push(`edit:${text}`);
      },
    });

    await queue.sendOrEdit("Same text");
    await queue.sendOrEdit("Same text");
    await queue.sendOrEdit("Same text");

    expect(calls).toEqual(["send:Same text"]);
  });

  it("skips empty/whitespace-only text", async () => {
    const calls: string[] = [];
    const queue = createEditQueue({
      sendMessage: async (text) => {
        calls.push(`send:${text}`);
        return { id: "msg-1" };
      },
      editMessage: async (text) => {
        calls.push(`edit:${text}`);
      },
    });

    const r1 = await queue.sendOrEdit("");
    const r2 = await queue.sendOrEdit("   ");

    expect(r1).toBe(false);
    expect(r2).toBe(false);
    expect(calls).toEqual([]);
  });

  it("stops processing after an API error", async () => {
    const calls: string[] = [];
    let failNext = false;
    const queue = createEditQueue({
      sendMessage: async (text) => {
        if (failNext) throw new Error("API error");
        calls.push(`send:${text}`);
        return { id: "msg-1" };
      },
      editMessage: async (text) => {
        if (failNext) throw new Error("API error");
        calls.push(`edit:${text}`);
      },
    });

    await queue.sendOrEdit("First");
    failNext = true;
    const r2 = await queue.sendOrEdit("Second — will fail");
    // After error, draftState.stopped = true, subsequent calls are skipped
    const r3 = await queue.sendOrEdit("Third — should be skipped");

    expect(calls).toEqual(["send:First"]);
    expect(r2).toBe(false);
    expect(r3).toBe(false);
    expect(queue.draftState.stopped).toBe(true);
  });

  it("serializes concurrent calls in order", async () => {
    const order: number[] = [];
    let resolvers: Array<() => void> = [];

    const queue = createEditQueue({
      sendMessage: async () => {
        // Simulate slow network — resolve is controlled externally
        await new Promise<void>((r) => resolvers.push(r));
        order.push(1);
        return { id: "msg-1" };
      },
      editMessage: async () => {
        await new Promise<void>((r) => resolvers.push(r));
        order.push(order.length + 1);
      },
    });

    // Fire three calls concurrently
    const p1 = queue.sendOrEdit("A");
    const p2 = queue.sendOrEdit("B");
    const p3 = queue.sendOrEdit("C");

    // Resolve them one by one — queue ensures serial execution
    await vi.waitFor(() => expect(resolvers.length).toBe(1));
    resolvers[0](); // resolve sendMessage for "A"
    await p1;

    await vi.waitFor(() => expect(resolvers.length).toBe(2));
    resolvers[1](); // resolve editMessage for "B"
    await p2;

    await vi.waitFor(() => expect(resolvers.length).toBe(3));
    resolvers[2](); // resolve editMessage for "C"
    await p3;

    expect(order).toEqual([1, 2, 3]);
  });

  it("trims trailing whitespace before sending", async () => {
    const calls: string[] = [];
    const queue = createEditQueue({
      sendMessage: async (text) => {
        calls.push(text);
        return { id: "msg-1" };
      },
      editMessage: async (text) => {
        calls.push(text);
      },
    });

    await queue.sendOrEdit("Hello   \n\n");
    expect(calls).toEqual(["Hello"]);
  });
});

/**
 * Unit tests for the cleanupAndSend fallback pattern used in channel.ts.
 *
 * When the final editMessage call fails (e.g. message was deleted, network
 * error), channel.ts must send a fresh message first, then delete the stale
 * draft. This send-first ordering prevents losing the agent's completed
 * reply when the replacement send itself fails (#391: long messages
 * exceeding the server's 4000 char limit were silently lost because the
 * draft was deleted before the failing replacement send).
 */
describe("cleanupAndSend fallback", () => {
  /** Minimal reproduction of the cleanupAndSend helper from dispatch.ts */
  async function cleanupAndSend(opts: {
    deleteMessage: (id: string) => Promise<void>;
    sendMessage: (text: string) => Promise<void>;
    draftMessageId: string | undefined;
    text: string;
  }): Promise<void> {
    // Send replacement first — if this throws, the draft is preserved so
    // content is never lost.
    await opts.sendMessage(opts.text);
    if (opts.draftMessageId) {
      try {
        await opts.deleteMessage(opts.draftMessageId);
      } catch {
        // Best-effort cleanup; draft cleanup failure is non-fatal.
      }
    }
  }

  it("sends fresh message first, then deletes stale draft", async () => {
    const calls: string[] = [];
    await cleanupAndSend({
      deleteMessage: async (id) => { calls.push(`delete:${id}`); },
      sendMessage: async (text) => { calls.push(`send:${text}`); },
      draftMessageId: "draft-1",
      text: "Final reply",
    });
    expect(calls).toEqual(["send:Final reply", "delete:draft-1"]);
  });

  it("still succeeds when draft deletion fails", async () => {
    const calls: string[] = [];
    await cleanupAndSend({
      deleteMessage: async () => { throw new Error("404 Not Found"); },
      sendMessage: async (text) => { calls.push(`send:${text}`); },
      draftMessageId: "draft-gone",
      text: "Final reply",
    });
    expect(calls).toEqual(["send:Final reply"]);
  });

  it("sends directly when no draft exists", async () => {
    const calls: string[] = [];
    await cleanupAndSend({
      deleteMessage: async () => { calls.push("delete — should not happen"); },
      sendMessage: async (text) => { calls.push(`send:${text}`); },
      draftMessageId: undefined,
      text: "No draft reply",
    });
    expect(calls).toEqual(["send:No draft reply"]);
  });

  it("preserves draft when replacement send fails (#391)", async () => {
    /**
     * Regression: send-before-delete ordering ensures the user's content
     * is preserved (in the draft) when the replacement send itself fails.
     * Previously the draft was deleted first, then the failing send left
     * the channel empty.
     */
    const calls: string[] = [];
    await expect(
      cleanupAndSend({
        deleteMessage: async (id) => { calls.push(`delete:${id}`); },
        sendMessage: async () => { throw new Error("400 content too long"); },
        draftMessageId: "draft-keep",
        text: "x".repeat(5000),
      }),
    ).rejects.toThrow("400 content too long");
    expect(calls).toEqual([]); // draft must NOT be deleted when send fails
  });

  it("final edit failure triggers fallback to cleanupAndSend", async () => {
    /**
     * Simulates the full deliver() path: first tries editMessage, and on
     * failure falls through to cleanupAndSend.
     */
    const calls: string[] = [];
    const draftMessageId = "draft-99";
    const text = "Completed agent response";

    // Simulate the deliver() logic from dispatch.ts
    try {
      // editMessage fails
      throw new Error("Discord API 404");
    } catch {
      // Falls through to cleanupAndSend
      await cleanupAndSend({
        deleteMessage: async (id) => { calls.push(`delete:${id}`); },
        sendMessage: async (t) => { calls.push(`send:${t}`); },
        draftMessageId,
        text,
      });
    }

    expect(calls).toEqual(["send:Completed agent response", "delete:draft-99"]);
  });
});
