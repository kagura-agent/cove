import { useMemo, useState } from "react";
import { Modal, Input, InputNumber, Radio, Select, Switch } from "antd";
import type { Task, TaskStatus } from "@cove/shared";
import { useMemberStore } from "../stores/useMemberStore";
import { useActiveIds } from "../hooks/useActiveIds";
import * as api from "../lib/api";
import { HEARTBEAT_OPTIONS } from "../lib/constants";
import { getStatusLabelOptions } from "../lib/taskStatusConfig";
import {
  CRON_CATCH_UP_OPTIONS,
  DEFAULT_CRON_TZ,
  REPEAT_INTERVAL_OPTIONS,
  REPEAT_SCHEDULE_OPTIONS,
  isValidCronExpression,
  recurrenceEditorSettingsFromTemplate,
  repeatScheduleIntervalMs,
  type RepeatIntervalUnit,
  type RepeatSchedule,
  type RecurrenceCatchUp,
} from "../lib/recurrence";

interface TaskEditDialogProps {
  task: Task;
  open: boolean;
  onClose: () => void;
}

/**
 * Shared task edit dialog. Used by both the channel Tasks tab (ChatArea's
 * InlineTaskList) and the guild Tasks board (TaskBoard).
 *
 * Parent must pass a `key` that changes with the target task (e.g.
 * `key={task.task_id}`) so state re-initializes per task.
 */
export function TaskEditDialog({ task, open, onClose }: TaskEditDialogProps) {
  // Compute recurrence-derived defaults once per mount (parent keys by task id).
  const [initial] = useState(() => {
    const rec = task.recurrence ? recurrenceEditorSettingsFromTemplate(task.recurrence) : null;
    return {
      repeatEnabled: rec?.enabled ?? false,
      repeatSchedule: (rec?.schedule ?? "never") as RepeatSchedule,
      occurrenceMode: (rec?.occurrenceMode ?? "same_task") as api.RecurringTaskOccurrenceMode,
      repeatIntervalValue: rec?.intervalValue ?? 1,
      repeatIntervalUnit: (rec?.intervalUnit ?? "days") as RepeatIntervalUnit,
      cronExpr: rec?.cronExpr ?? "",
      cronTz: rec?.cronTz ?? DEFAULT_CRON_TZ,
      cronCatchUp: (rec?.catchUp ?? "skip") as RecurrenceCatchUp,
    };
  });

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [assigneeId, setAssigneeId] = useState<string | undefined>(task.assignee_id ?? undefined);
  const [heartbeatEnabled, setHeartbeatEnabled] = useState((task.heartbeat_interval_ms ?? 0) > 0);
  const [heartbeatInterval, setHeartbeatInterval] = useState(task.heartbeat_interval_ms > 0 ? task.heartbeat_interval_ms : 3600000);
  const [recurrence] = useState<Task["recurrence"]>(task.recurrence);
  const [repeatEnabled, setRepeatEnabled] = useState(initial.repeatEnabled);
  const [repeatSchedule, setRepeatSchedule] = useState<RepeatSchedule>(initial.repeatSchedule);
  const [occurrenceMode, setOccurrenceMode] = useState<api.RecurringTaskOccurrenceMode>(initial.occurrenceMode);
  const [repeatIntervalValue, setRepeatIntervalValue] = useState(initial.repeatIntervalValue);
  const [repeatIntervalUnit, setRepeatIntervalUnit] = useState<RepeatIntervalUnit>(initial.repeatIntervalUnit);
  const [cronExpr, setCronExpr] = useState(initial.cronExpr);
  const [cronTz, setCronTz] = useState(initial.cronTz);
  const [cronCatchUp, setCronCatchUp] = useState<RecurrenceCatchUp>(initial.cronCatchUp);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { guildId } = useActiveIds();
  const membersByGuildId = useMemberStore((s) => s.membersByGuildId);
  const members = useMemo(() => Object.values(guildId ? membersByGuildId[guildId] ?? {} : {}), [membersByGuildId, guildId]);

  const repeatIntervalMs = repeatScheduleIntervalMs(repeatSchedule, repeatIntervalValue, repeatIntervalUnit);
  const canEditRecurrence = !recurrence || recurrence.root_task_id === task.task_id;
  const validRepeatInterval = repeatSchedule === "never" || repeatSchedule === "cron"
    || (Number.isFinite(repeatIntervalMs) && repeatIntervalMs > 0);
  const validCron = repeatSchedule !== "cron" || isValidCronExpression(cronExpr);

  async function handleSave() {
    if (!canEditRecurrence || !validRepeatInterval || !validCron) return;
    setSaving(true);
    setSaveError(null);
    try {
      const nextRecurrence = repeatSchedule === "never"
        ? (recurrence ? null : undefined)
        : repeatSchedule === "cron"
          ? {
              cron_expr: cronExpr.trim(),
              cron_tz: cronTz.trim() || DEFAULT_CRON_TZ,
              catch_up: cronCatchUp,
              occurrence_mode: occurrenceMode,
              enabled: repeatEnabled,
            }
          : {
              interval_ms: repeatIntervalMs,
              occurrence_mode: occurrenceMode,
              enabled: repeatEnabled,
            };
      await api.updateTask(task.task_id, {
        title: title.trim(),
        description: description.trim(),
        status,
        assignee_id: assigneeId ?? null,
        heartbeat_interval_ms: heartbeatEnabled ? heartbeatInterval : 0,
        ...(nextRecurrence !== undefined ? { recurrence: nextRecurrence } : {}),
      });
      onClose();
    } catch (err) {
      console.error("update task:", err);
      setSaveError("Task changes could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Edit Task"
      open={open}
      onCancel={() => {
        setSaveError(null);
        onClose();
      }}
      onOk={handleSave}
      okText="Save"
      okButtonProps={{ loading: saving, disabled: !title.trim() || (!validRepeatInterval || !validCron) }}
      destroyOnClose
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {saveError && <div style={{ fontSize: 12, color: "var(--danger, #ed4245)" }}>{saveError}</div>}
        <div>
          <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: "block" }}>Title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: "block" }}>Description</label>
          <Input.TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </div>
        <div>
          <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: "block" }}>Status</label>
          <Select
            value={status}
            onChange={setStatus}
            style={{ width: "100%" }}
            options={getStatusLabelOptions()}
          />
        </div>
        <div>
          <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: "block" }}>Assignee</label>
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
        {canEditRecurrence && (
          <>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: "block" }}>Repeat enabled</label>
              <Switch checked={repeatEnabled} onChange={setRepeatEnabled} size="small" />
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: "block" }}>Repeat</label>
              <Select
                value={repeatSchedule}
                onChange={(schedule) => {
                  setRepeatSchedule(schedule);
                  setRepeatEnabled(schedule !== "never");
                }}
                style={{ width: "100%" }}
                options={REPEAT_SCHEDULE_OPTIONS}
              />
              {repeatSchedule === "custom" && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                  <span>Every</span>
                  <InputNumber disabled={!repeatEnabled} min={1} value={repeatIntervalValue} onChange={(value) => setRepeatIntervalValue(value ?? 0)} style={{ flex: 1 }} />
                  <Select disabled={!repeatEnabled} value={repeatIntervalUnit} onChange={setRepeatIntervalUnit} style={{ width: 120 }} options={REPEAT_INTERVAL_OPTIONS} />
                </div>
              )}
              {repeatSchedule === "cron" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                  <Input
                    disabled={!repeatEnabled}
                    placeholder="e.g. 15,45 8-22 * * *  or  0 20 * * 0"
                    value={cronExpr}
                    onChange={(e) => setCronExpr(e.target.value)}
                  />
                  {repeatEnabled && !validCron && <div style={{ fontSize: 11, color: "var(--danger, #ed4245)" }}>Enter a valid 5- or 6-field cron expression.</div>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <Select
                      disabled={!repeatEnabled}
                      value={cronTz}
                      onChange={setCronTz}
                      style={{ flex: 1 }}
                      options={[{ value: "Asia/Shanghai", label: "Asia/Shanghai" }, { value: "UTC", label: "UTC" }]}
                    />
                    <Select
                      disabled={!repeatEnabled}
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
              {repeatEnabled && repeatSchedule === "custom" && !validRepeatInterval && <div style={{ fontSize: 11, color: "var(--danger, #ed4245)", marginTop: 4 }}>Enter a positive interval.</div>}
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: "block" }}>Next occurrence</label>
              <Radio.Group disabled={!repeatEnabled} value={occurrenceMode} onChange={(event) => setOccurrenceMode(event.target.value)}>
                <Radio value="same_task">In this task</Radio>
                <Radio value="new_task">New task</Radio>
              </Radio.Group>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                In this task reopens the current task and conversation. New task creates a separate task and conversation.
              </div>
            </div>
          </>
        )}
        <div>
          <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: "block" }}>Heartbeat</label>
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
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Nudge agent when thread goes silent</div>
        </div>
      </div>
    </Modal>
  );
}
