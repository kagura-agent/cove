import { describe, expect, it } from "vitest";
import { executionDetailsPlacement } from "./MessageAgentRunDetails";

function anchor(overrides: Partial<DOMRect> = {}): DOMRect {
  return { left: 100, top: 100, right: 220, bottom: 124, width: 120, height: 24, x: 100, y: 100, toJSON: () => ({}), ...overrides } as DOMRect;
}

describe("execution details popover placement", () => {
  it("places the popover below its chip when there is room", () => {
    expect(executionDetailsPlacement(anchor(), { width: 1000, height: 800 })).toMatchObject({ placement: "below", top: 132, left: 100, width: 420 });
  });

  it("flips above and clamps near the viewport edge", () => {
    const placement = executionDetailsPlacement(anchor({ left: 900, top: 700, bottom: 724 }), { width: 1000, height: 800 });
    expect(placement).toMatchObject({ placement: "above", left: 568 });
    expect(placement.top).toBeGreaterThanOrEqual(12);
    expect(placement.maxHeight).toBeLessThanOrEqual(360);
  });
});
