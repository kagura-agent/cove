import { describe, it, expect, vi } from "vitest";

/**
 * Unit tests for the cove.md channel resolution logic used in dispatch.ts.
 *
 * For thread channels (type 11 with parent_id), the dispatch pipeline reads
 * cove.md from the parent channel rather than the thread itself, since threads
 * don't have their own cove.md files.  This test extracts that resolution
 * logic to verify the behavior without importing the full dispatch runtime.
 */

/**
 * Minimal reproduction of the cove.md channel resolution pattern from dispatch.ts.
 *
 * @param channelId - The channel ID from the inbound message
 * @param getChannel - Async function that fetches channel metadata
 * @returns The channel ID to use for getCoveMd lookup
 */
async function resolveCoveMdChannelId(
  channelId: string,
  getChannel: (id: string) => Promise<{ type: number; parent_id?: string }>,
): Promise<string> {
  let coveMdChannelId = channelId;
  try {
    const channel = await getChannel(channelId);
    if (channel.type === 11 && channel.parent_id) {
      coveMdChannelId = channel.parent_id;
    }
  } catch {
    // Fall back to channelId on error (dispatch.ts line 271)
  }
  return coveMdChannelId;
}

describe("cove.md channel resolution", () => {
  it("uses parent_id for thread channels (type 11 with parent_id)", async () => {
    const getChannel = vi.fn().mockResolvedValue({
      type: 11,
      parent_id: "parent-123",
    });

    const result = await resolveCoveMdChannelId("thread-456", getChannel);

    expect(result).toBe("parent-123");
    expect(getChannel).toHaveBeenCalledWith("thread-456");
    expect(getChannel).toHaveBeenCalledTimes(1);
  });

  it("uses original channelId for non-thread channels", async () => {
    const getChannel = vi.fn().mockResolvedValue({
      type: 0, // Text channel
    });

    const result = await resolveCoveMdChannelId("channel-789", getChannel);

    expect(result).toBe("channel-789");
    expect(getChannel).toHaveBeenCalledWith("channel-789");
    expect(getChannel).toHaveBeenCalledTimes(1);
  });

  it("falls back to channelId when getChannel throws", async () => {
    const getChannel = vi.fn().mockRejectedValue(new Error("network error"));

    const result = await resolveCoveMdChannelId("channel-789", getChannel);

    expect(result).toBe("channel-789");
    expect(getChannel).toHaveBeenCalledWith("channel-789");
    expect(getChannel).toHaveBeenCalledTimes(1);
  });

  it("uses original channelId when thread has no parent_id", async () => {
    // Edge case: type 11 but missing parent_id (malformed thread)
    const getChannel = vi.fn().mockResolvedValue({
      type: 11,
      parent_id: undefined,
    });

    const result = await resolveCoveMdChannelId("thread-orphan", getChannel);

    expect(result).toBe("thread-orphan");
    expect(getChannel).toHaveBeenCalledWith("thread-orphan");
  });

  it("uses original channelId when parent_id is empty string", async () => {
    // Edge case: parent_id exists but is empty
    const getChannel = vi.fn().mockResolvedValue({
      type: 11,
      parent_id: "",
    });

    const result = await resolveCoveMdChannelId("thread-empty-parent", getChannel);

    expect(result).toBe("thread-empty-parent");
    expect(getChannel).toHaveBeenCalledWith("thread-empty-parent");
  });
});
