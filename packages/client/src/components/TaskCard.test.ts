import { describe, expect, it } from "vitest";
import { taskAssignmentSummary } from "./TaskCard";

describe("taskAssignmentSummary", () => {
  it("includes the assignment recipient in the compact system event", () => {
    expect(taskAssignmentSummary("task_id: task-1\nTitle: Review inbox\nAssigned to: Kagura")).toBe("Review inbox — assigned to Kagura");
  });

  it("falls back to the legacy summary when the recipient is absent", () => {
    expect(taskAssignmentSummary("task_id: task-1\nTitle: Review inbox")).toBe("Review inbox — assigned");
  });

  it("does not expose the raw assignment instruction when the title is absent", () => {
    expect(taskAssignmentSummary("task_id: task-1\nInternal instruction")).toBe("Task — assigned");
  });
});
