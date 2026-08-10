import { describe, expect, it } from "vitest";
import { shouldDispatchImmediately } from "./control-message.js";

describe("control-message dispatch", () => {
  it.each(["/stop", "stop", "interrupt", "停止"])("bypasses the serial queue for %s", (content) => {
    expect(shouldDispatchImmediately({ content })).toBe(true);
  });

  it("keeps an ordinary follow-up on the configured queue", () => {
    expect(shouldDispatchImmediately({ content: "Please continue with the next step." })).toBe(false);
  });
});
