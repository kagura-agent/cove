import { useState, useMemo } from "react";
import { Modal, Input, Select, Switch } from "antd";
import { useActiveIds } from "../hooks/useActiveIds";
import { useMemberStore } from "../stores/useMemberStore";
import * as api from "../lib/api";

const HEARTBEAT_OPTIONS = [
  { label: "5 min", value: 300000 },
  { label: "10 min", value: 600000 },
  { label: "15 min", value: 900000 },
  { label: "30 min", value: 1800000 },
  { label: "60 min", value: 3600000 },
  { label: "120 min", value: 7200000 },
];

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
  const [heartbeatInterval, setHeartbeatInterval] = useState(600000); // default 10min
  const [submitting, setSubmitting] = useState(false);
  const { guildId } = useActiveIds();
  const membersByGuildId = useMemberStore((s) => s.membersByGuildId);
  const members = useMemo(() => Object.values(guildId ? membersByGuildId[guildId] ?? {} : {}), [membersByGuildId, guildId]);

  async function handleCreate() {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const intervalMs = heartbeatEnabled ? heartbeatInterval : undefined;
      await api.createTask(channelId, title.trim(), assigneeId, description.trim() || undefined, intervalMs);
      setTitle("");
      setDescription("");
      setAssigneeId(undefined);
      setHeartbeatEnabled(false);
      setHeartbeatInterval(600000);
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
      okButtonProps={{ disabled: !title.trim(), loading: submitting }}
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
