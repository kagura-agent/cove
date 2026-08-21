import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useChannelStore } from "../stores/useChannelStore";
import { useActiveIds } from "../hooks/useActiveIds";
import { useTaskStore } from "../stores/useTaskStore";
import { useTaskEfficiencyStore } from "../stores/useTaskEfficiencyStore";
import { useTaskUsageStore } from "../stores/useTaskUsageStore";
import { useMemberStore } from "../stores/useMemberStore";
import { Typography, Button, Popconfirm, Table, Tag, Space, Select } from "antd";
import { MenuOutlined, DeleteOutlined, TeamOutlined, EditOutlined, MessageOutlined, RetweetOutlined } from "@ant-design/icons";
import { MessageList } from "./MessageList";
import { TaskEditDialog } from "./TaskEditDialog";
import { routes } from "../lib/routes";
import * as api from "../lib/api";
import type { CSSProperties } from "react";
import type { Task, TaskStatus, AgentRunUsage } from "@cove/shared";
import type { ColumnsType } from "antd/es/table";
import { ChatMarkdown } from "./ChatMarkdown";
import { UsageChip } from "./UsageChip";
import { TaskHealthLine } from "./TaskHealthLine";
import { dispatcher } from "../lib/gateway-dispatcher";
import { ThreadIcon } from "./ThreadIcon";
import { FilesSidebar } from "./FilesSidebar";
import { getStatusSelectOptions, getStatusFilterOptions } from "../lib/taskStatusConfig";
import type { Channel } from "../types";
import {
  recurrenceScheduleLabel,
  recurrenceSeriesLabel,
} from "../lib/recurrence";

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
  const [channelUsage, setChannelUsage] = useState<AgentRunUsage | null | undefined>(undefined);

  // Channel-scope aggregate: ALL runs anchored to the channel (chat + every
  // thread). Refetch when the channel changes; live-refresh on usage events;
  // failures degrade to no chip.
  useEffect(() => {
    if (!channelId || channel?.type === 11) return;
    let alive = true;
    const refresh = () => {
      api.fetchChannelUsage(channelId).then((u) => { if (alive) setChannelUsage(u); }).catch(() => { if (alive) setChannelUsage(null); });
    };
    refresh();
    const onUsage = (run: { channel_id: string }) => { if (run.channel_id === channelId) refresh(); };
    dispatcher.on("AGENT_USAGE_UPDATED", onUsage);
    return () => { alive = false; dispatcher.off("AGENT_USAGE_UPDATED", onUsage); };
  }, [channelId, channel?.type]);

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
        <UsageChip usage={channelUsage} scope="channel" />
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
  const navigate = useNavigate();
  const { guildId, threadId } = useActiveIds();
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const removeTask = useTaskStore((s) => s.removeTask);
  const byTaskId = useTaskStore((s) => s.byTaskId);
  const efficiencyByTask = useTaskEfficiencyStore((s) => s.byChannel[channelId]);
  const fetchChannelEfficiency = useTaskEfficiencyStore((s) => s.fetchChannel);
  // Per-task usage rollups via the shared task usage store (cached + in-flight
  // deduped, invalidated by AGENT_USAGE_UPDATED inside the store).
  const taskUsages = useTaskUsageStore((s) => s.byChannel[channelId]);
  const fetchChannelUsage = useTaskUsageStore((s) => s.fetchChannel);
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

  // Channel-wide efficiency as the shared baseline for row-level health lines.
  useEffect(() => {
    fetchChannelEfficiency(channelId);
    // Usage rollups: idempotent (cached + in-flight deduped in the store).
    fetchChannelUsage(channelId);
  }, [channelId, fetchChannelEfficiency, fetchChannelUsage]);

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
      render: (title: string, task) => {
        const seriesLabel = recurrenceSeriesLabel(task.recurring_seq, task.recurrence);
        const scheduleLabel = recurrenceScheduleLabel(task.recurrence);
        return (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", minWidth: 0 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
            {scheduleLabel && <Tag icon={<RetweetOutlined />} style={{ flexShrink: 0 }}>{scheduleLabel}</Tag>}
            {seriesLabel && <Tag style={{ flexShrink: 0 }}>{seriesLabel}</Tag>}
          </div>
        );
      },
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
      title: "Usage",
      key: "usage",
      width: 130,
      render: (_, task) => <UsageChip usage={taskUsages?.[task.task_id]} scope="task" />,
    },
    {
      title: "Health",
      key: "health",
      width: 230,
      render: (_, task) => (
        <TaskHealthLine report={efficiencyByTask?.[task.task_id]} />
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 120,
      render: (_, task) => (
        <Space size="small">
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditingTask(task)} title="Edit" />
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
      {editingTask && (
        <TaskEditDialog key={editingTask.task_id} task={editingTask} open onClose={() => setEditingTask(null)} />
      )}
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
