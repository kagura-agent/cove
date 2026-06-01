import {
  type ChannelProgressDraftLine,
  isChannelProgressDraftWorkToolName,
  formatChannelProgressDraftLineForEntry,
  formatChannelProgressDraftLine,
  buildChannelProgressDraftLineForEntry,
  mergeChannelProgressDraftLine,
  formatChannelProgressDraftText,
  resolveChannelProgressDraftMaxLines,
  createChannelProgressDraftGate,
} from "openclaw/plugin-sdk/channel-streaming";

type ProgressLine = string | ChannelProgressDraftLine;

export interface ToolProgressTracker {
  onToolStart(payload: {
    name?: string;
    toolName?: string;
    args?: Record<string, unknown>;
    phase?: string;
    detailMode?: string;
  }): void;
  onItemEvent(payload: {
    itemId?: string;
    kind?: string;
    title?: string;
    name?: string;
    phase?: string;
    status?: string;
    summary?: string;
    progressText?: string;
    meta?: string;
  }): void;
  onPlanUpdate(payload: {
    phase?: string;
    title?: string;
    explanation?: string;
    steps?: string[];
  }): void;
  onApprovalEvent(payload: {
    phase?: string;
    title?: string;
    command?: string;
    reason?: string;
    message?: string;
  }): void;
  onCommandOutput(payload: {
    phase?: string;
    title?: string;
    name?: string;
    status?: string;
    exitCode?: number | null;
  }): void;
  onPatchSummary(payload: {
    phase?: string;
    title?: string;
    name?: string;
    added?: string[];
    modified?: string[];
    deleted?: string[];
    summary?: string;
  }): void;
  onCompactionStart(): void;
  onCompactionEnd(): void;
  onPartialReply(text: string): void;
  onAssistantMessageStart(): void;
  getCombinedText(): string;
  gate: ReturnType<typeof createChannelProgressDraftGate>;
}

export function createToolProgressTracker(
  channelConfig?: Record<string, unknown>,
  options?: { seed?: string; onProgressUpdate?: () => void },
): ToolProgressTracker {
  const entry = channelConfig ?? {};
  const seed = options?.seed ?? String(Date.now());
  const notify = options?.onProgressUpdate ?? (() => {});

  let assistantText = "";
  let lines: ProgressLine[] = [];
  let compacting = false;
  const maxLines = resolveChannelProgressDraftMaxLines(entry);

  const pushLine = (line: ProgressLine | null | undefined) => {
    if (!line) return;
    const normalized: ProgressLine = typeof line === "string"
      ? line.replace(/\s+/g, " ").trim()
      : { ...line, text: (line.text ?? "").replace(/\s+/g, " ").trim() };
    if (typeof normalized === "string" ? !normalized : !normalized.text) return;
    lines = mergeChannelProgressDraftLine(lines, normalized, { maxLines });
    notify();
  };

  const renderProgress = (): string => {
    if (compacting) return "📦 **Compacting context...**";
    if (lines.length === 0) return "";
    return formatChannelProgressDraftText({ entry, lines, seed }) ?? "";
  };

  const gate = createChannelProgressDraftGate({
    onStart: () => { notify(); },
  });

  return {
    gate,

    onToolStart(payload) {
      const name = payload.name ?? payload.toolName ?? "tool";
      if (!isChannelProgressDraftWorkToolName(name)) return;
      const line = formatChannelProgressDraftLineForEntry(
        entry,
        { event: "tool", name, phase: payload.phase, args: payload.args },
        payload.detailMode ? { detailMode: payload.detailMode as "explain" | "raw" } : undefined,
      );
      if (line) {
        pushLine(line);
        gate.startNow();
      }
    },

    onItemEvent(payload) {
      pushLine(buildChannelProgressDraftLineForEntry(entry, {
        event: "item",
        itemId: payload.itemId,
        itemKind: payload.kind,
        title: payload.title,
        name: payload.name,
        phase: payload.phase,
        status: payload.status,
        summary: payload.summary,
        progressText: payload.progressText,
        meta: payload.meta,
      }));
      gate.noteWork();
    },

    onPlanUpdate(payload) {
      if (payload.phase !== "update") return;
      pushLine(formatChannelProgressDraftLine({
        event: "plan",
        phase: payload.phase,
        title: payload.title,
        explanation: payload.explanation,
        steps: payload.steps,
      }));
      gate.noteWork();
    },

    onApprovalEvent(payload) {
      if (payload.phase !== "requested") return;
      pushLine(formatChannelProgressDraftLine({
        event: "approval",
        phase: payload.phase,
        title: payload.title,
        command: payload.command,
        reason: payload.reason,
        message: payload.message,
      }));
      gate.noteWork();
    },

    onCommandOutput(payload) {
      if (payload.phase !== "end") return;
      pushLine(formatChannelProgressDraftLine({
        event: "command-output",
        phase: payload.phase,
        title: payload.title,
        name: payload.name,
        status: payload.status,
        exitCode: payload.exitCode,
      }));
      gate.noteWork();
    },

    onPatchSummary(payload) {
      if (payload.phase !== "end") return;
      pushLine(formatChannelProgressDraftLine({
        event: "patch",
        phase: payload.phase,
        title: payload.title,
        name: payload.name,
        added: payload.added,
        modified: payload.modified,
        deleted: payload.deleted,
        summary: payload.summary,
      }));
      gate.noteWork();
    },

    onCompactionStart() {
      compacting = true;
      notify();
    },

    onCompactionEnd() {
      compacting = false;
      notify();
    },

    onPartialReply(text: string) {
      assistantText = text;
      lines = [];
      compacting = false;
    },

    onAssistantMessageStart() {
      lines = [];
      compacting = false;
    },

    getCombinedText(): string {
      if (!gate.hasStarted && !compacting) {
        return assistantText;
      }
      const parts: string[] = [];
      if (assistantText) parts.push(assistantText);
      const progress = renderProgress();
      if (progress) parts.push(progress);
      return parts.join("\n\n");
    },
  };
}
