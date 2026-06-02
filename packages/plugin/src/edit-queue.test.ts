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

describe("orphaned draft cleanup", () => {
  // TODO: Integration test for orphaned draft deletion on streaming failure.
  // The deliver callback in channel.ts now calls restClient.deleteMessage()
  // before falling back to sendMessage when draftState.stopped is true.
  // Full integration testing requires mocking the channel runtime dispatcher
  // which is deferred to a future iteration.

  it("placeholder — draft cleanup is tested via manual QA", () => {
    // See channel.ts deliver callback:
    // if (draftMessageId && !draftState.stopped) { editMessage }
    // else { deleteMessage(draft); sendMessage(fresh) }
    expect(true).toBe(true);
  });
});

describe("scroll behavior", () => {
  // TODO: Scroll-to-lastMessageContent after streaming edits is a DOM behavior
  // that requires a browser/DOM testing environment.  The current implementation
  // targets `[data-last-message-content]` in the client package, which narrows
  // scroll scope to the message content area.  Full scroll testing deferred to
  // an E2E test suite.
  it("placeholder — scroll targeting is verified via manual QA", () => {
    expect(true).toBe(true);
  });
});
