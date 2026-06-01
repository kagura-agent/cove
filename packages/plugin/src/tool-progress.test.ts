import { describe, it, expect, vi, beforeEach } from "vitest";
import { createToolProgressTracker } from "./tool-progress.js";

vi.mock("openclaw/plugin-sdk/channel-streaming", () => {
  return {
    isChannelProgressDraftWorkToolName: (name: string) => {
      const skip = new Set(["idle", "noop"]);
      return !skip.has(name);
    },
    formatChannelProgressDraftLineForEntry: (
      _entry: any,
      input: { event: string; name: string },
    ) => `📖 ${input.name}`,
    formatChannelProgressDraftLine: (input: any) => {
      if (input.event === "plan") return `🗺️ ${input.title ?? "plan"}`;
      if (input.event === "approval") return `⚠️ ${input.title ?? "approval"}`;
      if (input.event === "command-output") return `💻 ${input.name ?? "cmd"}`;
      if (input.event === "patch") return `📝 ${input.name ?? "patch"}`;
      return input.title ?? input.event;
    },
    buildChannelProgressDraftLineForEntry: (
      _entry: any,
      input: { event: string; title?: string; name?: string },
    ) => `🔔 ${input.title ?? input.name ?? input.event}`,
    mergeChannelProgressDraftLine: (
      lines: any[],
      line: any,
      _opts: any,
    ) => [...lines, line],
    formatChannelProgressDraftText: (opts: {
      entry: any;
      lines: any[];
      seed: string;
    }) => {
      if (opts.lines.length === 0) return "";
      return "Working\n\n" + opts.lines.map((l: any) => `• ${typeof l === "string" ? l : l.text}`).join("\n");
    },
    resolveChannelProgressDraftMaxLines: () => 8,
    createChannelProgressDraftGate: (opts?: { onStart?: () => void }) => {
      let started = false;
      let workCount = 0;
      return {
        get hasStarted() { return started; },
        get workEvents() { return workCount; },
        noteWork() { workCount++; },
        startNow() {
          started = true;
          opts?.onStart?.();
        },
        cancel() { started = false; },
      };
    },
  };
});

describe("createToolProgressTracker", () => {
  let tracker: ReturnType<typeof createToolProgressTracker>;
  let onUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onUpdate = vi.fn();
    tracker = createToolProgressTracker({}, { seed: "test", onProgressUpdate: onUpdate });
  });

  describe("onToolStart", () => {
    it("formats a progress line for work tools", () => {
      tracker.onToolStart({ name: "Read", args: { file: "/foo" } });
      expect(onUpdate).toHaveBeenCalled();
      expect(tracker.gate.hasStarted).toBe(true);
    });

    it("filters out non-work tools", () => {
      tracker.onToolStart({ name: "idle" });
      expect(onUpdate).not.toHaveBeenCalled();
      expect(tracker.gate.hasStarted).toBe(false);
    });

    it("multiple calls stack lines", () => {
      tracker.onToolStart({ name: "Read" });
      tracker.onToolStart({ name: "Bash" });
      tracker.gate.startNow();
      const text = tracker.getCombinedText();
      expect(text).toContain("Read");
      expect(text).toContain("Bash");
    });
  });

  describe("onPartialReply", () => {
    it("clears progress lines and sets assistant text", () => {
      tracker.onToolStart({ name: "Read" });
      tracker.gate.startNow();
      expect(tracker.getCombinedText()).toContain("Read");

      tracker.onPartialReply("Hello world");
      expect(tracker.getCombinedText()).toBe("Hello world");
    });
  });

  describe("onAssistantMessageStart", () => {
    it("clears progress lines", () => {
      tracker.onToolStart({ name: "Read" });
      tracker.onAssistantMessageStart();
      tracker.gate.startNow();
      const text = tracker.getCombinedText();
      expect(text).not.toContain("Read");
    });
  });

  describe("compaction", () => {
    it("onCompactionStart shows compaction message", () => {
      tracker.onCompactionStart();
      const text = tracker.getCombinedText();
      expect(text).toContain("Compacting context");
    });

    it("onCompactionEnd clears compaction message", () => {
      tracker.onCompactionStart();
      tracker.onCompactionEnd();
      tracker.gate.startNow();
      const text = tracker.getCombinedText();
      expect(text).not.toContain("Compacting");
    });
  });

  describe("getCombinedText", () => {
    it("returns only assistant text when gate not started and not compacting", () => {
      tracker.onPartialReply("Just text");
      expect(tracker.getCombinedText()).toBe("Just text");
    });

    it("composes assistant text + progress when gate started", () => {
      tracker.onPartialReply("Reply so far");
      tracker.onToolStart({ name: "Grep" });
      // onToolStart calls startNow on gate
      const text = tracker.getCombinedText();
      expect(text).toContain("Reply so far");
      expect(text).toContain("Grep");
    });

    it("returns empty when nothing happened", () => {
      expect(tracker.getCombinedText()).toBe("");
    });
  });

  describe("onItemEvent", () => {
    it("produces a line and notes work", () => {
      tracker.onItemEvent({ title: "Task created", kind: "task" });
      expect(onUpdate).toHaveBeenCalled();
      expect(tracker.gate.workEvents).toBe(1);
    });
  });

  describe("onPlanUpdate", () => {
    it("produces a line for update phase", () => {
      tracker.onPlanUpdate({ phase: "update", title: "My Plan" });
      expect(onUpdate).toHaveBeenCalled();
      tracker.gate.startNow();
      expect(tracker.getCombinedText()).toContain("My Plan");
    });

    it("ignores non-update phases", () => {
      tracker.onPlanUpdate({ phase: "start", title: "My Plan" });
      expect(onUpdate).not.toHaveBeenCalled();
    });
  });

  describe("onCommandOutput", () => {
    it("produces a line for end phase", () => {
      tracker.onCommandOutput({ phase: "end", name: "npm test", status: "success" });
      expect(onUpdate).toHaveBeenCalled();
      tracker.gate.startNow();
      expect(tracker.getCombinedText()).toContain("npm test");
    });

    it("ignores non-end phases", () => {
      tracker.onCommandOutput({ phase: "start", name: "npm test" });
      expect(onUpdate).not.toHaveBeenCalled();
    });
  });

  describe("onPatchSummary", () => {
    it("produces a line for end phase", () => {
      tracker.onPatchSummary({ phase: "end", name: "app.ts", modified: ["app.ts"] });
      expect(onUpdate).toHaveBeenCalled();
      tracker.gate.startNow();
      expect(tracker.getCombinedText()).toContain("app.ts");
    });

    it("ignores non-end phases", () => {
      tracker.onPatchSummary({ phase: "start", name: "app.ts" });
      expect(onUpdate).not.toHaveBeenCalled();
    });
  });

  describe("gate delays initial display", () => {
    it("getCombinedText suppresses progress until gate starts", () => {
      tracker.onItemEvent({ title: "task" });
      // gate not started yet — work noted but not displayed
      expect(tracker.gate.hasStarted).toBe(false);
      expect(tracker.getCombinedText()).toBe("");
    });

    it("getCombinedText shows progress after gate starts", () => {
      tracker.onToolStart({ name: "Read" });
      // onToolStart calls gate.startNow for work tools
      expect(tracker.gate.hasStarted).toBe(true);
      expect(tracker.getCombinedText()).toContain("Read");
    });
  });

  describe("onApprovalEvent", () => {
    it("produces a line for requested phase", () => {
      tracker.onApprovalEvent({ phase: "requested", title: "Run command?" });
      expect(onUpdate).toHaveBeenCalled();
    });

    it("ignores non-requested phases", () => {
      tracker.onApprovalEvent({ phase: "approved", title: "Run command?" });
      expect(onUpdate).not.toHaveBeenCalled();
    });
  });
});
