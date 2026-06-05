import { describe, it, expect, vi } from "vitest";
import { dispatcher } from "./gateway-dispatcher";

describe("GatewayDispatcher", () => {
  it("calls registered handler with correct data on emit", () => {
    const handler = vi.fn();
    dispatcher.on("MESSAGE_DELETE", handler);
    dispatcher.emit("MESSAGE_DELETE", { id: "1", channel_id: "c1" });
    expect(handler).toHaveBeenCalledWith({ id: "1", channel_id: "c1" });
    dispatcher.off("MESSAGE_DELETE", handler);
  });

  it("does not call handler after off", () => {
    const handler = vi.fn();
    dispatcher.on("MESSAGE_DELETE", handler);
    dispatcher.off("MESSAGE_DELETE", handler);
    dispatcher.emit("MESSAGE_DELETE", { id: "1", channel_id: "c1" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("handler removing itself during emit does not crash and other handlers fire", () => {
    const calls: string[] = [];
    const selfRemover = () => {
      calls.push("selfRemover");
      dispatcher.off("MESSAGE_DELETE", selfRemover);
    };
    const other = () => {
      calls.push("other");
    };
    dispatcher.on("MESSAGE_DELETE", selfRemover);
    dispatcher.on("MESSAGE_DELETE", other);
    dispatcher.emit("MESSAGE_DELETE", { id: "1", channel_id: "c1" });
    expect(calls).toEqual(["selfRemover", "other"]);
    dispatcher.off("MESSAGE_DELETE", other);
  });

  it("emit with no handlers registered does not crash", () => {
    expect(() => {
      dispatcher.emit("CHANNEL_DELETE", { id: "x", guild_id: "g1" });
    }).not.toThrow();
  });
});
