import { useState, useMemo } from "react";
import { Modal, Input, InputNumber, Select, Switch } from "antd";
import { useActiveIds } from "../hooks/useActiveIds";
import { useMemberStore } from "../stores/useMemberStore";
import * as api from "../lib/api";
import { HEARTBEAT_OPTIONS } from "../lib/constants";

interface Props {
  channelId: string;
  open: boolean;
  onClose: () => void;
}

export function CreateTaskDialog({ channelId, open, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | undefined>(undefined);
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(true);
  const [heartbeatInterval, setHeartbeatInterval] = useState(600000); // default 10min
  const [repeatSchedule, setRepeatSchedule] = useState<"never" | "on_complete" | "interval">("never");
  const [occurrenceMode, setOccurrenceMode] = useState<"same_task" | "new_task">("new_task");
  const [repeatIntervalValue, setRepeatIntervalValue] = useState(1);
  const [repeatIntervalUnit, setRepeatIntervalUnit] = useState<"minutes" | "hours" | "days">("days");
  const [submitting, setSubmitting] = useState(false);
  const { guildId } = useActiveIds();
  const membersByGuildId = useMemberStore((s) => s.membersByGuildId);
  const members = useMemo(() => Object.values(guildId ? membersByGuildId[guildId] ?? {} : {}), [membersByGuildId, guildId]);

  const repeatIntervalMs = repeatIntervalValue * ({ minutes: 60_000, hours: 3_600_000, days: 86_400_000 }[repeatIntervalUnit]);
  const validRepeatInterval = Number.isFinite(repeatIntervalMs) && repeatIntervalMs > 0;

  async function handleCreate() {
    if (!title.trim() || (repeatSchedule === "interval" && !validRepeatInterval)) return;
    setSubmitting(true);
    try {
      const heartbeatIntervalMs = heartbeatEnabled ? heartbeatInterval : undefined;
      if (repeatSchedule === "never") {
        await api.createTask(channelId, title.trim(), assigneeId, description.trim() || undefined, heartbeatIntervalMs);
      } else {
        await api.createRecurringTask(channelId, {
          title: title.trim(),
          ...(assigneeId ? { assignee_id: assigneeId } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          schedule_type: repeatSchedule,
          ...(repeatSchedule === "interval" ? { interval_ms: repeatIntervalMs } : {}),
          occurrence_mode: occurrenceMode,
          ...(heartbeatIntervalMs ? { heartbeat_interval_ms: heartbeatIntervalMs } : {}),
        });
      }
      setTitle("");
      setDescription("");
      setAssigneeId(undefined);
      setHeartbeatEnabled(false);
      setHeartbeatInterval(600000);
      setRepeatSchedule("never");
      setOccurrenceMode("new_task");
      setRepeatIntervalValue(1);
      setRepeatIntervalUnit("days");
      onClose();
    } catch (err) {
      console.error("create task:", err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="New Task"
      open={open}
      onCancel={onClose}
      onOk={handleCreate}
      okText="Create"
      okButtonProps={{ disabled: !title.trim() || (repeatSchedule === "interval" && !validRepeatInterval), loading: submitting }}
      destroyOnClose
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md, 12px)" }}>
        <div>
          <label style={{ fontSize: "var(--font-size-sm, 13px)", fontWeight: 500, marginBottom: 4, display: "block" }}>
            Title
          </label>
          <Input
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onPressEnter={handleCreate}
            autoFocus
          />
        </div>
        <div>
          <label style={{ fontSize: "var(--font-size-sm, 13px)", fontWeight: 500, marginBottom: 4, display: "block" }}>
            Description (optional)
          </label>
          <Input.TextArea
            placeholder="Task description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>
        <div>
          <label style={{ fontSize: "var(--font-size-sm, 13px)", fontWeight: 500, marginBottom: 4, display: "block" }}>
            Assignee (optional)
          </label>
          <Select
            placeholder="Select assignee"
            value={assigneeId}
            onChange={setAssigneeId}
            allowClear
            style={{ width: "100%" }}
            options={members.map((m) => ({
              label: m.nick || m.user.global_name || m.user.username,
              value: m.user.id,
            }))}
          />
        </div>
        <div>
          <label style={{ fontSize: "var(--font-size-sm, 13px)", fontWeight: 500, marginBottom: 4, display: "block" }}>
            Repeat
          </label>
          <Select
            value={repeatSchedule}
            onChange={setRepeatSchedule}
            style={{ width: "100%" }}
            options={[
              { value: "never", label: "Never" },
              { value: "on_complete", label: "After completion" },
              { value: "interval", label: "After a delay" },
            ]}
          />
          {repeatSchedule === "interval" && (
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <InputNumber min={1} value={repeatIntervalValue} onChange={(value) => setRepeatIntervalValue(value ?? 0)} style={{ flex: 1 }} />
              <Select
                value={repeatIntervalUnit}
                onChange={setRepeatIntervalUnit}
                style={{ width: 120 }}
                options={[
                  { value: "minutes", label: "minutes" },
                  { value: "hours", label: "hours" },
                  { value: "days", label: "days" },
                ]}
              />
            </div>
          )}
          {repeatSchedule === "interval" && !validRepeatInterval && <div style={{ fontSize: 11, color: "var(--danger, #ed4245)", marginTop: 4 }}>Enter a positive duration.</div>}
        </div>
        {repeatSchedule !== "never" && (
          <div>
            <label style={{ fontSize: "var(--font-size-sm, 13px)", fontWeight: 500, marginBottom: 4, display: "block" }}>
              Next occurrence
            </label>
            <Select
              value={occurrenceMode}
              onChange={setOccurrenceMode}
              style={{ width: "100%" }}
              options={[
                { value: "same_task", label: "Reopen this task" },
                { value: "new_task", label: "Create a new task" },
              ]}
            />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              Reopen keeps the same task and conversation. Create a new task makes a separate task and conversation.
            </div>
          </div>
        )}
        <div>
          <label style={{ fontSize: "var(--font-size-sm, 13px)", fontWeight: 500, marginBottom: 4, display: "block" }}>
            Heartbeat
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Switch checked={heartbeatEnabled} onChange={setHeartbeatEnabled} size="small" />
            {heartbeatEnabled && (
              <Select
                value={heartbeatInterval}
                onChange={setHeartbeatInterval}
                style={{ width: 120 }}
                options={HEARTBEAT_OPTIONS}
              />
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
            Nudge agent when thread goes silent
          </div>
        </div>
      </div>
    </Modal>
  );
}
