import { useState, useMemo } from "react";
import { Modal, Input, InputNumber, Radio, Select, Switch } from "antd";
import { useActiveIds } from "../hooks/useActiveIds";
import { useMemberStore } from "../stores/useMemberStore";
import * as api from "../lib/api";
import { HEARTBEAT_OPTIONS } from "../lib/constants";
import {
  REPEAT_INTERVAL_OPTIONS,
  REPEAT_SCHEDULE_OPTIONS,
  repeatScheduleIntervalMs,
  type RepeatIntervalUnit,
  type RepeatSchedule,
} from "../lib/recurrence";

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
  const [repeatSchedule, setRepeatSchedule] = useState<RepeatSchedule>("never");
  const [occurrenceMode, setOccurrenceMode] = useState<"same_task" | "new_task">("same_task");
  const [repeatIntervalValue, setRepeatIntervalValue] = useState(1);
  const [repeatIntervalUnit, setRepeatIntervalUnit] = useState<RepeatIntervalUnit>("days");
  const [submitting, setSubmitting] = useState(false);
  const { guildId } = useActiveIds();
  const membersByGuildId = useMemberStore((s) => s.membersByGuildId);
  const members = useMemo(() => Object.values(guildId ? membersByGuildId[guildId] ?? {} : {}), [membersByGuildId, guildId]);

  const intervalMs = repeatScheduleIntervalMs(repeatSchedule, repeatIntervalValue, repeatIntervalUnit);
  const validRepeatInterval = Number.isFinite(intervalMs) && intervalMs > 0;

  async function handleCreate() {
    if (!title.trim() || (repeatSchedule === "custom" && !validRepeatInterval)) return;
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
          interval_ms: intervalMs,
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
      setOccurrenceMode("same_task");
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
      okButtonProps={{ disabled: !title.trim() || (repeatSchedule === "custom" && !validRepeatInterval), loading: submitting }}
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
            options={REPEAT_SCHEDULE_OPTIONS}
          />
          {repeatSchedule === "custom" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <span>Every</span>
              <InputNumber min={1} value={repeatIntervalValue} onChange={(value) => setRepeatIntervalValue(value ?? 0)} style={{ flex: 1 }} />
              <Select
                value={repeatIntervalUnit}
                onChange={setRepeatIntervalUnit}
                style={{ width: 120 }}
                options={REPEAT_INTERVAL_OPTIONS}
              />
            </div>
          )}
          {repeatSchedule === "custom" && !validRepeatInterval && <div style={{ fontSize: 11, color: "var(--danger, #ed4245)", marginTop: 4 }}>Enter a positive interval.</div>}
        </div>
        {repeatSchedule !== "never" && (
          <div>
            <label style={{ fontSize: "var(--font-size-sm, 13px)", fontWeight: 500, marginBottom: 4, display: "block" }}>
              Next occurrence
            </label>
            <Radio.Group value={occurrenceMode} onChange={(event) => setOccurrenceMode(event.target.value)}>
              <Radio value="same_task">In this task</Radio>
              <Radio value="new_task">New task</Radio>
            </Radio.Group>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              In this task reopens the current task and conversation. New task creates a separate task and conversation.
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
