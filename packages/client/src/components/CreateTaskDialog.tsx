import { useState, useMemo } from "react";
import { Modal, Input, Select } from "antd";
import { useActiveIds } from "../hooks/useActiveIds";
import { useMemberStore } from "../stores/useMemberStore";
import * as api from "../lib/api";

interface Props {
  channelId: string;
  open: boolean;
  onClose: () => void;
}

export function CreateTaskDialog({ channelId, open, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const { guildId } = useActiveIds();
  const membersByGuildId = useMemberStore((s) => s.membersByGuildId);
  const members = useMemo(() => Object.values(guildId ? membersByGuildId[guildId] ?? {} : {}), [membersByGuildId, guildId]);

  async function handleCreate() {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await api.createTask(channelId, title.trim(), assigneeId);
      setTitle("");
      setAssigneeId(undefined);
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
      </div>
    </Modal>
  );
}
