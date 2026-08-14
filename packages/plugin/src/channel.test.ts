import { describe, expect, it } from "vitest";
import { shouldNotifyAgentForMessage } from "./channel.js";

const message = (metadata?: string) => ({ metadata });

describe("shouldNotifyAgentForMessage", () => {
  it("keeps ordinary messages and suppresses task cards", () => {
    expect(shouldNotifyAgentForMessage(message(), "agent-a")).toBe(true);
    expect(shouldNotifyAgentForMessage(message(JSON.stringify({ skip_agent_notify: true })), "agent-a")).toBe(false);
  });

  it("delivers assignment and heartbeat execution messages only to their assignee", () => {
    expect(shouldNotifyAgentForMessage(message(JSON.stringify({ content_type: "task_assignment", assignee_id: "agent-a" })), "agent-a")).toBe(true);
    expect(shouldNotifyAgentForMessage(message(JSON.stringify({ content_type: "task_heartbeat", assignee_id: "bot-a" })), "agent-a", "bot-a")).toBe(true);
    expect(shouldNotifyAgentForMessage(message(JSON.stringify({ content_type: "task_assignment", assignee_id: "agent-b" })), "agent-a", "bot-a")).toBe(false);
    expect(shouldNotifyAgentForMessage(message(JSON.stringify({ content_type: "task_heartbeat", assignee_id: "agent-b" })), "agent-a", "bot-a")).toBe(false);
  });

  it("does not treat untargeted execution messages as agent input", () => {
    expect(shouldNotifyAgentForMessage(message(JSON.stringify({ content_type: "task_assignment" })), "agent-a")).toBe(false);
    expect(shouldNotifyAgentForMessage(message(JSON.stringify({ content_type: "task_heartbeat" })), "agent-a")).toBe(false);
  });
});
