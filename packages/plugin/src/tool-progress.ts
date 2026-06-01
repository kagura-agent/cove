import {
  isChannelProgressDraftWorkToolName,
  formatChannelProgressDraftLineForEntry,
} from "openclaw/plugin-sdk/channel-streaming";

export interface ToolProgressTracker {
  onToolStart(payload: {
    name?: string;
    toolName?: string;
    args?: Record<string, unknown>;
    phase?: string;
    detailMode?: string;
  }): void;
  onPartialReply(text: string): void;
  onAssistantMessageStart(): void;
  getCombinedText(): string;
}

export function createToolProgressTracker(
  channelConfig?: Record<string, unknown>,
): ToolProgressTracker {
  let assistantText = "";
  let statusLine = "";

  return {
    onToolStart(payload) {
      const name = payload.name ?? payload.toolName ?? "tool";
      if (!isChannelProgressDraftWorkToolName(name)) return;

      const line = formatChannelProgressDraftLineForEntry(
        channelConfig ?? {},
        {
          event: "tool",
          name,
          phase: payload.phase,
          args: payload.args,
        },
        { detailMode: payload.detailMode as "explain" | "raw" | undefined },
      );

      if (line) statusLine = line;
    },

    onPartialReply(text: string) {
      assistantText = text;
      statusLine = "";
    },

    onAssistantMessageStart() {
      statusLine = "";
    },

    getCombinedText(): string {
      const parts: string[] = [];
      if (assistantText) parts.push(assistantText);
      if (statusLine) parts.push(statusLine);
      return parts.join("\n\n");
    },
  };
}
