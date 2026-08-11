import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk/outbound-media", () => ({ loadOutboundMediaFromUrl: vi.fn() }));

import { loadOutboundMediaFromUrl } from "openclaw/plugin-sdk/outbound-media";
import { createCoveOutboundBridgeAdapter } from "./outbound.js";

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body ?? "")),
  } as unknown as Response;
}

describe("Cove outbound media bridge", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(loadOutboundMediaFromUrl).mockResolvedValue({
      buffer: Buffer.from("gif-bytes"), contentType: "image/gif", fileName: "reaction.gif", kind: "image",
    } as any);
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.restoreAllMocks();
  });

  it("uploads an allowed GIF and preserves its caption", async () => {
    fetchMock.mockResolvedValueOnce(response(201, { id: "media-message" }));
    const adapter = createCoveOutboundBridgeAdapter({ agentId: "kagura" });

    const result = await adapter.sendMedia!({
      cfg: { channels: { cove: { token: "bot-token", baseUrl: "https://cove.test" } } },
      to: "channel-1",
      text: "A reaction",
      mediaUrl: "file:///workspace/reaction.gif",
    } as any);

    expect(result).toEqual({ messageId: "media-message" });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://cove.test/api/v10/channels/channel-1/messages");
    expect(options.headers).toEqual({ Authorization: "Bot bot-token" });
    const form = options.body as FormData;
    expect(form.get("payload_json")).toBe(JSON.stringify({ content: "A reaction" }));
    expect((form.get("files[0]") as File).type).toBe("image/gif");
  });

  it("rejects unsupported media before sending", async () => {
    const adapter = createCoveOutboundBridgeAdapter({ agentId: "kagura" });
    vi.mocked(loadOutboundMediaFromUrl).mockResolvedValueOnce({
      buffer: Buffer.from("text"), contentType: "text/plain", fileName: "note.txt", kind: "document",
    } as any);

    await expect(adapter.sendMedia!({
      cfg: { channels: { cove: { token: "bot-token", baseUrl: "https://cove.test" } } },
      to: "channel-1",
      text: "A note",
      mediaUrl: "file:///workspace/note.txt",
    } as any)).rejects.toThrow(/unsupported outbound media type/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
