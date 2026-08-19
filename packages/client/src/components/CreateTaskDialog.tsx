import { useState, useMemo } from "react";
import { Modal, Input, InputNumber, Radio, Select, Switch } from "antd";
import { useActiveIds } from "../hooks/useActiveIds";
import { useMemberStore } from "../stores/useMemberStore";
import * as api from "../lib/api";
import { HEARTBEAT_OPTIONS } from "../lib/constants";
import {
  CRON_CATCH_UP_OPTIONS,
  DEFAULT_CRON_TZ,
  REPEAT_INTERVAL_OPTIONS,
  REPEAT_SCHEDULE_OPTIONS,
  isValidCronExpression,
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
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(false);
  const [heartbeatInterval, setHeartbeatInterval] = useState(3600000); // default 1h
  const [repeatSchedule, setRepeatSchedule] = useState<RepeatSchedule>("never");
  const [occurrenceMode, setOccurrenceMode] = useState<"same_task" | "new_task">("same_task");
  const [repeatIntervalValue, setRepeatIntervalValue] = useState(1);
  const [repeatIntervalUnit, setRepeatIntervalUnit] = useState<RepeatIntervalUnit>("days");
  const [cronExpr, setCronExpr] = useState("");
  const [cronTz, setCronTz] = useState(DEFAULT_CRON_TZ);
  const [cronCatchUp, setCronCatchUp] = useState<"skip" | "run">("skip");
  const [submitting, setSubmitting] = useState(false);
  const { guildId } = useActiveIds();
  const membersByGuildId = useMemberStore((s) => s.membersByGuildId);
  const members = useMemo(() => Object.values(guildId ? membersByGuildId[guildId] ?? {} : {}), [membersByGuildId, guildId]);

  const intervalMs = repeatScheduleIntervalMs(repeatSchedule, repeatIntervalValue, repeatIntervalUnit);
  const validRepeatInterval = Number.isFinite(intervalMs) && intervalMs > 0;
  const validCron = repeatSchedule !== "cron" || isValidCronExpression(cronExpr);

  async function handleCreate() {
    if (!title.trim() || (repeatSchedule === "custom" && !validRepeatInterval) || (repeatSchedule === "cron" && !validCron)) return;
    setSubmitting(true);
    try {
      const heartbeatIntervalMs = heartbeatEnabled ? heartbeatInterval : undefined;
      await api.createTask(channelId, {
        title: title.trim(),
        ...(assigneeId ? { assignee_id: assigneeId } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(heartbeatIntervalMs ? { heartbeat_interval_ms: heartbeatIntervalMs } : {}),
        ...(repeatSchedule === "never" ? {} : repeatSchedule === "cron" ? {
          recurrence: {
            cron_expr: cronExpr.trim(),
            cron_tz: cronTz.trim() || DEFAULT_CRON_TZ,
            catch_up: cronCatchUp,
            occurrence_mode: occurrenceMode,
            enabled: true,
          },
        } : {
          recurrence: {
            interval_ms: intervalMs,
            occurrence_mode: occurrenceMode,
            enabled: true,
          },
        }),
      });
      setTitle("");
      setDescription("");
      setAssigneeId(undefined);
      setHeartbeatEnabled(false);
      setHeartbeatInterval(3600000);
      setRepeatSchedule("never");
      setOccurrenceMode("same_task");
      setRepeatIntervalValue(1);
      setRepeatIntervalUnit("days");
      setCronExpr("");
      setCronTz(DEFAULT_CRON_TZ);
      setCronCatchUp("skip");
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
      okButtonProps={{ disabled: !title.trim() || (repeatSchedule === "custom" && !validRepeatInterval) || (repeatSchedule === "cron" && !validCron), loading: submitting }}
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
          {repeatSchedule === "cron" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              <Input
                placeholder="e.g. 15,45 8-22 * * *  or  0 20 * * 0"
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
              />
              {!validCron && <div style={{ fontSize: 11, color: "var(--danger, #ed4245)" }}>Enter a valid 5- or 6-field cron expression.</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <Select
                  value={cronTz}
                  onChange={setCronTz}
                  style={{ flex: 1 }}
                  options={[{ value: "Asia/Shanghai", label: "Asia/Shanghai" }, { value: "UTC", label: "UTC" }]}
                />
                <Select
                  value={cronCatchUp}
                  onChange={setCronCatchUp}
                  style={{ flex: 1 }}
                  options={CRON_CATCH_UP_OPTIONS}
                />
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Standard cron: minute hour day-of-month month day-of-week. Skip missed runs avoids a burst after downtime; catch up backfills one run per missed fire.
              </div>
            </div>
          )}
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
