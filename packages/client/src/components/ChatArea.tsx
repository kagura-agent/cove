import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useChannelStore } from "../stores/useChannelStore";
import { useActiveIds } from "../hooks/useActiveIds";
import { useTaskStore } from "../stores/useTaskStore";
import { useChannelFilesStore } from "../stores/useChannelFilesStore";
import { useMemberStore } from "../stores/useMemberStore";
import { Typography, Button, Popconfirm, Table, Tag, Space, Input, Select, Modal, Switch } from "antd";
import { MenuOutlined, DeleteOutlined, TeamOutlined, EditOutlined, MessageOutlined } from "@ant-design/icons";
import { MessageList } from "./MessageList";
import { routes } from "../lib/routes";
import * as api from "../lib/api";
import type { CSSProperties } from "react";
import type { Task, TaskStatus } from "@cove/shared";
import type { ColumnsType } from "antd/es/table";
import { ChatMarkdown } from "./ChatMarkdown";
import { ThreadIcon } from "./ThreadIcon";
import { FilesSidebar } from "./FilesSidebar";
import { STATUS_ICON_COMPONENTS, getStatusSelectOptions, getStatusFilterOptions, getStatusLabelOptions } from "../lib/taskStatusConfig";
import type { Channel } from "../types";
import { HEARTBEAT_OPTIONS } from "../lib/constants";

type ChannelTab = "chat" | "tasks" | "files" | "threads";
type ThreadWithArchived = Channel & { _archived?: boolean };

const styles = {
  empty: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", gap: "var(--space-md)", opacity: 0.6 } as CSSProperties,
  wrapper: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden" } as CSSProperties,
  header: { display: "flex", alignItems: "center", gap: "var(--content-gap)", padding: "0 var(--content-pad)", paddingTop: "env(safe-area-inset-top, 0px)", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)", height: "var(--header-height)", flexShrink: 0 } as CSSProperties,
  menuBtn: { color: "var(--text-normal)" } as CSSProperties,
  membersBtn: { color: "var(--interactive-normal)" } as CSSProperties,
  membersBtnActive: { color: "var(--interactive-active)" } as CSSProperties,
  tabBar: { display: "flex", alignItems: "center", gap: 0, background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)", paddingLeft: "var(--content-pad)", flexShrink: 0 } as CSSProperties,
  tab: { padding: "8px 16px", fontSize: "var(--font-size-sm)", fontWeight: 500, cursor: "pointer", color: "var(--text-muted)", borderBottom: "2px solid transparent", transition: "color 0.15s, border-color 0.15s", userSelect: "none" } as CSSProperties,
  tabActive: { padding: "8px 16px", fontSize: "var(--font-size-sm)", fontWeight: 600, cursor: "pointer", color: "var(--header-primary)", borderBottom: "2px solid var(--accent, #5865f2)", transition: "color 0.15s, border-color 0.15s", userSelect: "none" } as CSSProperties,
  newTaskBtn: { background: "var(--accent, #5865f2)", color: "#fff", border: "none", borderRadius: "var(--space-xs)", padding: "var(--space-xs) var(--space-md)", fontSize: "var(--font-size-sm)", fontWeight: 600, cursor: "pointer", marginLeft: "auto", marginRight: "var(--content-pad)" } as CSSProperties,
  filesContainer: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" } as CSSProperties,
};

interface Props {
  onMenuClick?: () => void;
  onMembersClick?: () => void;
  membersOpen?: boolean;
  activeTab: ChannelTab;
  onTabChange: (tab: ChannelTab) => void;
  onNewTask: () => void;
}

export function ChatArea({ onMenuClick, onMembersClick, membersOpen, activeTab, onTabChange, onNewTask }: Props) {
  const { guildId, channelId } = useActiveIds();
  const getChannels = useChannelStore((s) => s.getChannels);
  const channels = getChannels(guildId);
  const channel = channels.find((c) => c.id === channelId);

  if (!channel) {
    return (
      <div style={styles.empty}>
        <span style={{ fontSize: "var(--icon-emoji-size)" }}>🌴</span>
        <p style={{ fontSize: "var(--font-size-lg)" }}>Select a channel from the sidebar</p>
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        {onMenuClick && <Button type="text" icon={<MenuOutlined />} onClick={onMenuClick} className="mobile-only" style={styles.menuBtn} />}
        <span style={{ fontSize: "var(--font-size-xl)", display: "flex", alignItems: "center", justifyContent: "center", width: "var(--avatar-size)", flexShrink: 0, lineHeight: 1 }}>#</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Typography.Title level={5} style={{ margin: 0, color: "var(--header-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{channel.name}</Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: "var(--font-size-sm)", display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{channel.topic ? <ChatMarkdown content={channel.topic} /> : "A cozy channel"}</Typography.Text>
        </div>
        {onMembersClick && <Button type="text" icon={<TeamOutlined />} onClick={onMembersClick} style={membersOpen ? styles.membersBtnActive : styles.membersBtn} />}
      </div>

      {/* Tab bar */}
      <div style={styles.tabBar}>
        <span style={activeTab === "chat" ? styles.tabActive : styles.tab} onClick={() => onTabChange("chat")}>Chat</span>
        <span style={activeTab === "tasks" ? styles.tabActive : styles.tab} onClick={() => onTabChange("tasks")}>Tasks</span>
        <span style={activeTab === "files" ? styles.tabActive : styles.tab} onClick={() => onTabChange("files")}>Files</span>
        <span style={activeTab === "threads" ? styles.tabActive : styles.tab} onClick={() => onTabChange("threads")}>Threads</span>
        {activeTab === "tasks" && (
          <button style={styles.newTaskBtn} onClick={onNewTask}>+ New Task</button>
        )}
      </div>

      {/* Tab content */}
      {activeTab === "chat" && <MessageList channelId={channel.id} />}
      {activeTab === "tasks" && channelId && <InlineTaskList channelId={channelId} />}
      {activeTab === "files" && channelId && (
        <div style={styles.filesContainer}>
          <FilesSidebar channelId={channelId} inline />
        </div>
      )}
      {activeTab === "threads" && channelId && <InlineThreadList channelId={channelId} />}
    </div>
  );
}

/** Inline task table for the Tasks tab */
function InlineTaskList({ channelId }: { channelId: string }) {
  const [loading, setLoading] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] = useState<TaskStatus>("open");
  const [editAssigneeId, setEditAssigneeId] = useState<string | undefined>(undefined);
  const [editHeartbeatEnabled, setEditHeartbeatEnabled] = useState(false);
  const [editHeartbeatInterval, setEditHeartbeatInterval] = useState(600000);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { guildId, threadId } = useActiveIds();
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const removeTask = useTaskStore((s) => s.removeTask);
  const byTaskId = useTaskStore((s) => s.byTaskId);
  const tasks = useMemo(() => Object.values(byTaskId).filter((t) => t.channel_id === channelId).sort((a, b) => b.updated_at - a.updated_at), [byTaskId, channelId]);
  const membersByGuildId = useMemberStore((s) => s.membersByGuildId);
  const members = useMemo(() => Object.values(guildId ? membersByGuildId[guildId] ?? {} : {}), [membersByGuildId, guildId]);

  // Build a userId -> display name map
  const userNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members) {
      map[m.user.id] = m.nick || m.user.global_name || m.user.username;
    }
    return map;
  }, [members]);

  useEffect(() => {
    setLoading(true);
    fetchTasks(channelId).finally(() => setLoading(false));
  }, [channelId, fetchTasks]);

  const handleOpenThread = useCallback((task: Task) => {
    if (guildId) {
      // Navigate with replace so closing thread goes back to tasks, not previous thread
      navigate(routes.thread(guildId, channelId, task.thread_id) + "?tab=tasks", { replace: true });
    }
  }, [guildId, channelId, navigate]);

  const handleDelete = useCallback(async (task: Task) => {
    try {
      await api.deleteTask(task.task_id);
      removeTask(task.task_id);
    } catch (err) {
      console.error("delete task:", err);
    }
  }, [removeTask]);

  const handleStatusChange = useCallback(async (task: Task, newStatus: TaskStatus) => {
    try {
      await api.updateTask(task.task_id, { status: newStatus });
    } catch (err) {
      console.error("update status:", err);
    }
  }, []);

  const handleEditOpen = useCallback((task: Task) => {
    setEditingTask(task);
    setEditTitle(task.title);
    setEditDescription(task.description ?? "");
    setEditStatus(task.status);
    setEditAssigneeId(task.assignee_id ?? undefined);
    setEditHeartbeatEnabled((task.heartbeat_interval_ms ?? 0) > 0);
    setEditHeartbeatInterval(task.heartbeat_interval_ms > 0 ? task.heartbeat_interval_ms : 600000);
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!editingTask) return;
    setSaving(true);
    try {
      await api.updateTask(editingTask.task_id, {
        title: editTitle.trim(),
        description: editDescription.trim(),
        status: editStatus,
        assignee_id: editAssigneeId ?? null,
        heartbeat_interval_ms: editHeartbeatEnabled ? editHeartbeatInterval : 0,
      });
      setEditingTask(null);
    } catch (err) {
      console.error("update task:", err);
    } finally {
      setSaving(false);
    }
  }, [editingTask, editTitle, editDescription, editStatus, editAssigneeId, editHeartbeatEnabled, editHeartbeatInterval]);

  const columns: ColumnsType<Task> = [
    {
      title: "#",
      dataIndex: "seq",
      key: "seq",
      width: 50,
      sorter: (a, b) => a.seq - b.seq,
    },
    {
      title: "Title",
      dataIndex: "title",
      key: "title",
      ellipsis: true,
      width: 300,
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 140,
      filters: getStatusFilterOptions(),
      onFilter: (value, record) => record.status === value,
      render: (status: TaskStatus, task: Task) => (
        <Select
          value={status}
          size="small"
          variant="borderless"
          style={{ width: "100%" }}
          onChange={(v) => handleStatusChange(task, v)}
          options={getStatusSelectOptions()}
        />
      ),
    },

    {
      title: "Assignee",
      dataIndex: "assignee_id",
      key: "assignee_id",
      width: 120,
      ellipsis: true,
      render: (id: string | null) => (id ? (userNameMap[id] || id) : "—"),
    },

    {
      title: "Updated",
      dataIndex: "updated_at",
      key: "updated_at",
      width: 150,
      sorter: (a, b) => a.updated_at - b.updated_at,
      render: (ts: number) => new Date(ts).toLocaleString(),
    },
    {
      title: "Actions",
      key: "actions",
      width: 120,
      render: (_, task) => (
        <Space size="small">
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEditOpen(task)} title="Edit" />
          <Button type="text" size="small" icon={<MessageOutlined />} onClick={() => handleOpenThread(task)} title="Open thread" />
          <Popconfirm title="Delete this task?" onConfirm={() => handleDelete(task)} okText="Delete" okButtonProps={{ danger: true }}>
            <Button type="text" size="small" icon={<DeleteOutlined />} danger title="Delete" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "var(--space-md)" }} className="scroll-container">
      <Table<Task>
        columns={columns}
        dataSource={tasks}
        rowKey="task_id"
        loading={loading}
        size="small"
        pagination={false}
        scroll={{ x: "max-content" }}
        rowClassName={(record) => record.thread_id === threadId ? "task-row-active-thread" : ""}
        locale={{ emptyText: 'No tasks yet. Click "+ New Task" to create one.' }}
      />
      <Modal
        title="Edit Task"
        open={!!editingTask}
        onCancel={() => setEditingTask(null)}
        onOk={handleEditSave}
        okText="Save"
        okButtonProps={{ loading: saving, disabled: !editTitle.trim() }}
        destroyOnClose
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: "block" }}>Title</label>
            <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: "block" }}>Description</label>
            <Input.TextArea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: "block" }}>Status</label>
            <Select
              value={editStatus}
              onChange={setEditStatus}
              style={{ width: "100%" }}
              options={getStatusLabelOptions()}
            />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: "block" }}>Assignee</label>
            <Select
              placeholder="Select assignee"
              value={editAssigneeId}
              onChange={setEditAssigneeId}
              allowClear
              style={{ width: "100%" }}
              options={members.map((m) => ({
                label: m.nick || m.user.global_name || m.user.username,
                value: m.user.id,
              }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: "block" }}>Heartbeat</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Switch checked={editHeartbeatEnabled} onChange={setEditHeartbeatEnabled} size="small" />
              {editHeartbeatEnabled && (
                <Select
                  value={editHeartbeatInterval}
                  onChange={setEditHeartbeatInterval}
                  style={{ width: 120 }}
                  options={HEARTBEAT_OPTIONS}
                />
              )}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Nudge agent when thread goes silent</div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** Inline thread table for the Threads tab */
function InlineThreadList({ channelId }: { channelId: string }) {
  const [allThreads, setAllThreads] = useState<ThreadWithArchived[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { guildId } = useActiveIds();
  const membersByGuildId = useMemberStore((s) => s.membersByGuildId);
  const members = useMemo(() => Object.values(guildId ? membersByGuildId[guildId] ?? {} : {}), [membersByGuildId, guildId]);
  const userNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members) map[m.user.id] = m.nick || m.user.global_name || m.user.username;
    return map;
  }, [members]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.fetchActiveThreads(channelId),
      api.fetchArchivedThreads(channelId),
    ]).then(([active, archived]) => {
      // Merge and dedupe by id
      const map = new Map<string, Channel & { _archived?: boolean }>();
      for (const t of active.threads) map.set(t.id, { ...t, _archived: false });
      for (const t of archived.threads) if (!map.has(t.id)) map.set(t.id, { ...t, _archived: true });
      setAllThreads(Array.from(map.values()));
    }).catch(console.error).finally(() => setLoading(false));
  }, [channelId]);

  const handleClick = useCallback((thread: Channel) => {
    if (guildId) {
      navigate(routes.thread(guildId, channelId, thread.id) + "?tab=threads", { replace: true });
    }
  }, [guildId, channelId, navigate]);

  const handleStatusChange = useCallback(async (thread: Channel, archived: boolean) => {
    try {
      await api.updateChannel(thread.id, { archived });
      // Update local state
      setAllThreads((prev) => prev.map((t) => t.id === thread.id ? { ...t, _archived: archived } : t));
    } catch (err) {
      console.error("update thread status:", err);
    }
  }, []);

  const columns: ColumnsType<Channel> = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      ellipsis: true,
      render: (name: string) => (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ThreadIcon size={14} style={{ opacity: 0.5, color: "var(--interactive-normal)", flexShrink: 0 }} />
          {name}
        </span>
      ),
    },
    {
      title: "Status",
      key: "status",
      width: 120,
      filters: [
        { text: "Active", value: "active" },
        { text: "Archived", value: "archived" },
      ],
      onFilter: (value, record) => (value === "archived") === !!(record as ThreadWithArchived)._archived,
      render: (_: unknown, record: Channel) => {
        const archived = (record as ThreadWithArchived)._archived;
        return (
          <Select
            value={archived ? "archived" : "active"}
            size="small"
            variant="borderless"
            style={{ width: "100%" }}
            onChange={(v) => handleStatusChange(record, v === "archived")}
            options={[
              { label: <Tag color="processing">Active</Tag>, value: "active" },
              { label: <Tag color="default">Archived</Tag>, value: "archived" },
            ]}
          />
        );
      },
    },
    {
      title: "Messages",
      dataIndex: "message_count",
      key: "message_count",
      width: 100,
      sorter: (a, b) => (a.message_count ?? 0) - (b.message_count ?? 0),
      render: (count: number | undefined) => count ?? 0,
    },
    {
      title: "Creator",
      dataIndex: "owner_id",
      key: "owner_id",
      width: 120,
      ellipsis: true,
      render: (id: string | null | undefined) => (id ? (userNameMap[id] || id) : "\u2014"),
    },
    {
      title: "Actions",
      key: "actions",
      width: 80,
      render: (_, thread) => (
        <Button type="text" size="small" icon={<MessageOutlined />} onClick={() => handleClick(thread)} title="Open thread" />
      ),
    },
  ];

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "var(--space-md)" }} className="scroll-container">
      <Table<Channel>
        columns={columns}
        dataSource={allThreads}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={false}
        sticky
        locale={{ emptyText: "No threads" }}
      />
    </div>
  );
}
