import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CoveRestClient } from "./rest-client.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function mockResponse(status: number, body?: unknown, headers?: Record<string, string>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body ?? "")),
  } as unknown as Response;
}

const BASE = "https://cove.test";
const TOKEN = "test-token";

let client: CoveRestClient;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
  client = new CoveRestClient(BASE, TOKEN);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * Run the promise to completion, advancing fake timers as needed.
 * Catches rejections to avoid unhandled-rejection warnings, then re-throws.
 */
async function settled<T>(promise: Promise<T>): Promise<T> {
  // Attach a no-op catch immediately to prevent PromiseRejectionHandledWarning
  const guarded = promise.catch(() => {});
  // Advance timers to drain all retry delays
  for (let i = 0; i < 20; i++) {
    await vi.advanceTimersByTimeAsync(30_000);
  }
  // Wait for the guarded promise to settle
  await guarded;
  // Now return the original (which may reject)
  return promise;
}

async function settledReject(promise: Promise<unknown>): Promise<Error> {
  // Attach a no-op catch immediately to prevent PromiseRejectionHandledWarning
  promise.catch(() => {});
  // Advance timers to drain all retry delays
  for (let i = 0; i < 20; i++) {
    await vi.advanceTimersByTimeAsync(30_000);
  }
  try {
    await promise;
    throw new Error("Expected promise to reject");
  } catch (err) {
    return err as Error;
  }
}

/* ------------------------------------------------------------------ */
/*  1. 204 No Content                                                  */
/* ------------------------------------------------------------------ */

describe("204 No Content", () => {
  it("deleteMessage returns undefined on 204", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(204));
    const result = await client.deleteMessage("ch1", "msg1");
    expect(result).toBeUndefined();
  });

  it("sendTyping returns undefined on 204", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(204));
    const result = await client.sendTyping("ch1");
    expect(result).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  2. Idempotent retry logic (5xx)                                    */
/* ------------------------------------------------------------------ */

describe("5xx retry — idempotent methods", () => {
  it("GET retries up to 3 times on 500 then succeeds", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(500))
      .mockResolvedValueOnce(mockResponse(500))
      .mockResolvedValueOnce(mockResponse(500))
      .mockResolvedValueOnce(mockResponse(200, { url: "wss://gw" }));

    const result = await settled(client.getGatewayUrl());
    expect(result).toBe("wss://gw");
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("DELETE retries on 500", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(500))
      .mockResolvedValueOnce(mockResponse(204));

    const result = await settled(client.deleteMessage("ch1", "msg1"));
    expect(result).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("GET throws after exhausting all retries", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(500))
      .mockResolvedValueOnce(mockResponse(500))
      .mockResolvedValueOnce(mockResponse(500))
      .mockResolvedValueOnce(mockResponse(500));

    const err = await settledReject(client.getGatewayUrl());
    expect(err.message).toContain("500");
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});

describe("5xx — non-idempotent methods (no retry)", () => {
  it("POST (sendMessage) does NOT retry on 500", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(500));

    const err = await settledReject(client.sendMessage("ch1", "hello"));
    expect(err.message).toContain("500");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("PATCH (editMessage) does NOT retry on 500", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(500));

    const err = await settledReject(client.editMessage("ch1", "msg1", "edited"));
    expect(err.message).toContain("500");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/*  3. 429 Rate Limit                                                  */
/* ------------------------------------------------------------------ */

describe("429 rate limit", () => {
  it("retries all methods on 429 (including POST)", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(429, null, { "Retry-After": "1" }))
      .mockResolvedValueOnce(mockResponse(200, { id: "m1", content: "ok" }));

    const result = await settled(client.sendMessage("ch1", "hello"));
    expect(result).toEqual({ id: "m1", content: "ok" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("parses Retry-After and caps at 30s", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(429, null, { "Retry-After": "120" }))
      .mockResolvedValueOnce(mockResponse(200, { url: "wss://gw" }));

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const result = await settled(client.getGatewayUrl());
    expect(result).toBe("wss://gw");

    // Retry-After=120 should be capped at 30 → delay = 30 * 1000 = 30000ms
    const retryCall = setTimeoutSpy.mock.calls.find(
      (call) => typeof call[1] === "number" && call[1] === 30_000,
    );
    expect(retryCall).toBeDefined();
  });

  it("falls back to 1s delay when Retry-After is garbage", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(429, null, { "Retry-After": "not-a-number" }))
      .mockResolvedValueOnce(mockResponse(200, { url: "wss://gw" }));

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const result = await settled(client.getGatewayUrl());
    expect(result).toBe("wss://gw");

    // parseFloat("not-a-number") → NaN → || 1 → 1 * 1000 = 1000ms
    const retryCall = setTimeoutSpy.mock.calls.find(
      (call) => typeof call[1] === "number" && call[1] === 1000,
    );
    expect(retryCall).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/*  4. Network errors                                                  */
/* ------------------------------------------------------------------ */

describe("network errors", () => {
  it("GET retries on fetch error", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(mockResponse(200, { url: "wss://gw" }));

    const result = await settled(client.getGatewayUrl());
    expect(result).toBe("wss://gw");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("POST does NOT retry on fetch error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNRESET"));

    const err = await settledReject(client.sendMessage("ch1", "hello"));
    expect(err.message).toContain("ECONNRESET");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("AbortError is thrown immediately without retry (GET)", async () => {
    const abortErr = new DOMException("The operation was aborted", "AbortError");
    mockFetch.mockRejectedValueOnce(abortErr);

    const err = await settledReject(client.getGatewayUrl());
    expect(err.message).toBe("The operation was aborted");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("AbortError is thrown immediately without retry (POST)", async () => {
    const abortErr = new DOMException("The operation was aborted", "AbortError");
    mockFetch.mockRejectedValueOnce(abortErr);

    const err = await settledReject(client.sendMessage("ch1", "hi"));
    expect(err.message).toBe("The operation was aborted");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/*  5. sendTyping timeout                                              */
/* ------------------------------------------------------------------ */

describe("sendTyping timeout", () => {
  it("passes an AbortSignal to fetch", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(204));
    await client.sendTyping("ch1");

    const call = mockFetch.mock.calls[0];
    const options = call[1] as RequestInit;
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
});
