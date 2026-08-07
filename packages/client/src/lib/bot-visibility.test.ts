import { describe, expect, it } from "vitest";
import { PermissionFlags } from "@cove/shared";
import { botVisibilityOverwrite } from "./bot-visibility";

describe("botVisibilityOverwrite", () => {
  it("allows a bot to view the channel when enabled", () => {
    expect(botVisibilityOverwrite(true)).toEqual({
      type: 1,
      allow: PermissionFlags.VIEW_CHANNEL,
      deny: "0",
    });
  });

  it("explicitly denies a bot when disabled so role permissions cannot restore visibility", () => {
    expect(botVisibilityOverwrite(false)).toEqual({
      type: 1,
      allow: "0",
      deny: PermissionFlags.VIEW_CHANNEL,
    });
  });
});
