import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Select, Table, Popconfirm, Tooltip, Space } from "antd";
import { CheckOutlined, ClockCircleOutlined, EditOutlined, InboxOutlined, MessageOutlined, ReloadOutlined, RetweetOutlined, UnorderedListOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { Task, TaskStatus, UpdateTaskFields } from "@cove/shared";
import { useActiveIds } from "../hooks/useActiveIds";
import { useGuildStore } from "../stores/useGuildStore";
import { useChannelStore } from "../stores/useChannelStore";
import { useMemberStore } from "../stores/useMemberStore";
import { useUserStore } from "../stores/useUserStore";
import { useTaskStore } from "../stores/useTaskStore";
import { useTaskEfficiencyStore } from "../stores/useTaskEfficiencyStore";
import { TaskHealthLine } from "./TaskHealthLine";
import { ThreadPanel } from "./ThreadPanel";
import { TaskEditDialog } from "./TaskEditDialog";
import { routes } from "../lib/routes";
import * as api from "../lib/api";
import { recurrenceScheduleLabel } from "../lib/recurrence";
import { getStatusSelectOptions, STATUS_TITLE_STYLE } from "../lib/taskStatusConfig";
import type { CSSProperties } from "react";

type BoardView = "mine" | "open" | "unassigned" | "closed";
type GroupBy = "channel" | "assignee" | "none";

const OPEN_STATUSES: TaskStatus[] = ["open", "in_progress", "in_review"];

const styles = {
  root: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden", background: "var(--bg-primary)" } as CSSProperties,
  header: { display: "flex", alignItems: "center", gap: "var(--content-gap)", padding: "0 var(--content-pad)", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)", height: "var(--header-height)", flexShrink: 0 } as CSSProperties,
  headerTitle: { margin: 0, color: "var(--header-primary)", fontSize: "var(--font-size-lg)", fontWeight: 700 } as CSSProperties,
  tabBar: { display: "flex", alignItems: "center", gap: 0, background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)", paddingLeft: "var(--content-pad)", flexShrink: 0 } as CSSProperties,
  tab: { padding: "8px 16px", fontSize: "var(--font-size-sm)", fontWeight: 500, cursor: "pointer", color: "var(--text-muted)", borderBottom: "2px solid transparent", transition: "color 0.15s, border-color 0.15s", userSelect: "none" } as CSSProperties,
  tabActive: { padding: "8px 16px", fontSize: "var(--font-size-sm)", fontWeight: 600, cursor: "pointer", color: "var(--header-primary)", borderBottom: "2px solid var(--accent, #5865f2)", transition: "color 0.15s, border-color 0.15s", userSelect: "none" } as CSSProperties,
  toolbar: { display: "flex", alignItems: "center", gap: "var(--space-sm)", padding: "var(--space-xs) var(--content-pad)", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 } as CSSProperties,
  content: { flex: 1, overflowY: "auto", padding: "var(--space-md)" } as CSSProperties,
  groupHeader: { display: "flex", alignItems: "center", gap: "var(--space-xs)", padding: "var(--space-md) var(--space-sm) var(--space-xs)", fontSize: "var(--font-size-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)" } as CSSProperties,
  channelLink: { color: "var(--interactive-active)", cursor: "pointer", textDecoration: "none", fontWeight: 600 } as CSSProperties,
  empty: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", gap: "var(--space-sm)", padding: "var(--space-xxl)" } as CSSProperties,
};

export function TaskBoard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedThreadId = searchParams.get("thread");
  const [threadPanelWidth, setThreadPanelWidth] = useState(400);
  const [resizeDragging, setResizeDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(400);
  const { guildId } = useActiveIds();
  const guilds = useGuildStore((s) => s.guilds);
  const channelsByGuildId = useChannelStore((s) => s.channelsByGuildId);
  const membersByGuildId = useMemberStore((s) => s.membersByGuildId);
  const selfId = useUserStore((s) => s.id);
  const byTaskId = useTaskStore((s) => s.byTaskId);
  const fetchGuildTasks = useTaskStore((s) => s.fetchGuildTasks);
  const efficiencyByChannel = useTaskEfficiencyStore((s) => s.byChannel);
  const fetchChannelEfficiency = useTaskEfficiencyStore((s) => s.fetchChannel);
  const [view, setView] = useState<BoardView>("open");
  const [groupBy, setGroupBy] = useState<GroupBy>("channel");
  const [loading, setLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [channelFilter, setChannelFilter] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  // Validate guild exists after data loads
  useEffect(() => {
    if (guildId && Object.keys(guilds).length > 0 && !guilds[guildId]) {
      navigate(routes.root(), { replace: true });
    }
  }, [guildId, guilds, navigate]);

  useEffect(() => {
    if (!guildId) return;
    setLoading(true);
    fetchGuildTasks(guildId).finally(() => setLoading(false));
  }, [guildId, fetchGuildTasks]);

  const channels = useMemo(() => (guildId ? channelsByGuildId[guildId] ?? [] : []), [channelsByGuildId, guildId]);
  const channelMap = useMemo(() => Object.fromEntries(channels.map((c) => [c.id, c])), [channels]);
  const members = useMemo(() => Object.values(guildId ? membersByGuildId[guildId] ?? {} : {}), [membersByGuildId, guildId]);
  const userNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members) map[m.user.id] = m.nick || m.user.global_name || m.user.username;
    return map;
  }, [members]);

  const guildTasks = useMemo(
    () => (guildId ? Object.values(byTaskId).filter((t) => t.guild_id === guildId) : []),
    [byTaskId, guildId],
  );

  // Channel-wide efficiency as the shared baseline for row-level health lines.
  // The board spans many channels, so fetch each channel that has tasks once
  // (store dedupes in-flight requests per channel).
  useEffect(() => {
    if (!guildId) return;
    const channelIds = new Set(guildTasks.map((t) => t.channel_id));
    for (const channelId of channelIds) {
      fetchChannelEfficiency(channelId);
    }
  }, [guildId, guildTasks, fetchChannelEfficiency]);

  const filtered = useMemo(() => {
    let list = guildTasks;
    if (channelFilter.length > 0) list = list.filter((t) => channelFilter.includes(t.channel_id));
    switch (view) {
      case "mine":
        return list.filter((t) => t.assignee_id === selfId && !["done", "cancelled"].includes(t.status));
      case "open":
        return list.filter((t) => OPEN_STATUSES.includes(t.status));
      case "unassigned":
        return list.filter((t) => t.assignee_id === null && OPEN_STATUSES.includes(t.status));
      case "closed":
        return list.filter((t) => ["done", "cancelled"].includes(t.status));
    }
  }, [guildTasks, view, selfId, channelFilter]);

  const counts = useMemo(() => {
    const mine = guildTasks.filter((t) => t.assignee_id === selfId && !["done", "cancelled"].includes(t.status)).length;
    const open = guildTasks.filter((t) => OPEN_STATUSES.includes(t.status)).length;
    const unassigned = guildTasks.filter((t) => t.assignee_id === null && OPEN_STATUSES.includes(t.status)).length;
    const closed = guildTasks.filter((t) => ["done", "cancelled"].includes(t.status)).length;
    return { mine, open, unassigned, closed };
  }, [guildTasks, selfId]);

  const grouped = useMemo(() => {
    const list = [...filtered].sort((a, b) => b.updated_at - a.updated_at);
    if (groupBy === "none") return [{ key: "all", label: null, tasks: list }];
    const map = new Map<string, Task[]>();
    for (const t of list) {
      const key = groupBy === "channel" ? t.channel_id : t.assignee_id ?? "unassigned";
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .map(([key, tasks]) => ({
        key,
        label: groupBy === "channel" ? channelMap[key]?.name ?? key : key === "unassigned" ? "Unassigned" : userNameMap[key] ?? key,
        tasks,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filtered, groupBy, channelMap, userNameMap]);

  const handleOpenThread = useCallback((task: Task) => {
    // Master-detail: keep the board mounted, show the thread in the right panel.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("thread", task.thread_id);
      return next;
    });
  }, [setSearchParams]);

  const closeThread = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("thread");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartWidth.current = threadPanelWidth;
    setResizeDragging(true);

    const onMouseMove = (ev: MouseEvent) => {
      const delta = dragStartX.current - ev.clientX;
      setThreadPanelWidth(Math.min(600, Math.max(280, dragStartWidth.current + delta)));
    };
    const onMouseUp = () => {
      setResizeDragging(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [threadPanelWidth]);

  const handleStatusChange = useCallback(async (task: Task, newStatus: TaskStatus) => {
    try {
      await api.updateTask(task.task_id, { status: newStatus });
    } catch (err) {
      console.error("update task status:", err);
    }
  }, []);

  const applyBatch = useCallback(async (fields: UpdateTaskFields) => {
    if (selectedRowKeys.length === 0) return;
    setBatchBusy(true);
    try {
      await Promise.all(selectedRowKeys.map((id) => api.updateTask(String(id), fields)));
      setSelectedRowKeys([]);
    } catch (err) {
      console.error("batch update tasks:", err);
    } finally {
      setBatchBusy(false);
    }
  }, [selectedRowKeys]);

  const columns: ColumnsType<Task> = [
    ...(groupBy !== "channel"
      ? [{
          title: "Channel",
          key: "channel",
          width: 140,
          ellipsis: true,
          render: (_: unknown, task: Task) => (
            <a
              style={styles.channelLink}
              onClick={(e) => { e.stopPropagation(); if (guildId) navigate(routes.channel(guildId, task.channel_id)); }}
            >
              #{channelMap[task.channel_id]?.name ?? task.channel_id.slice(0, 8)}
            </a>
          ),
        } satisfies ColumnsType<Task>[number]]
      : []),
    {
      title: "#",
      dataIndex: "seq",
      key: "seq",
      width: 50,
    },
    {
      title: "Title",
      dataIndex: "title",
      key: "title",
      ellipsis: true,
      render: (title: string, task) => (
        <span style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", minWidth: 0, ...STATUS_TITLE_STYLE[task.status] }}>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
          {recurrenceScheduleLabel(task.recurrence) && (
            <Tooltip title={recurrenceScheduleLabel(task.recurrence)!}>
              <RetweetOutlined style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            </Tooltip>
          )}
          {task.heartbeat_interval_ms > 0 && (
            <Tooltip title={`Heartbeat every ${Math.round(task.heartbeat_interval_ms / 60000)}m`}>
              <ClockCircleOutlined style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            </Tooltip>
          )}
        </span>
      ),
    },
    {
      title: "Health",
      key: "health",
      width: 230,
      render: (_, task) => (
        <TaskHealthLine report={efficiencyByChannel[task.channel_id]?.[task.task_id]} />
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 140,
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
    ...(groupBy !== "assignee"
      ? [{
          title: "Assignee",
          dataIndex: "assignee_id",
          key: "assignee_id",
          width: 120,
          ellipsis: true,
          render: (id: string | null) => (id ? userNameMap[id] || id : <span style={{ color: "var(--text-muted)" }}>—</span>),
        } satisfies ColumnsType<Task>[number]]
      : []),
    {
      title: "Updated",
      dataIndex: "updated_at",
      key: "updated_at",
      width: 150,
      render: (ts: number) => new Date(ts).toLocaleString(),
    },
    {
      title: "Actions",
      key: "actions",
      width: 100,
      render: (_, task) => (
        <Space size={0}>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={(e) => { e.stopPropagation(); setEditingTask(task); }}
            title="Edit task"
          />
          <Button
            type="text"
            size="small"
            icon={<MessageOutlined />}
            onClick={(e) => { e.stopPropagation(); handleOpenThread(task); }}
            title="Open thread"
          />
        </Space>
      ),
    },
  ];

  return (
    <div style={{ flex: 1, display: "flex", minWidth: 0, minHeight: 0, overflow: "hidden", background: "var(--bg-primary)" }}>
      <div style={styles.root}>
      <div style={styles.header}>
        <UnorderedListOutlined style={{ fontSize: "var(--font-size-xl)", color: "var(--text-normal)" }} />
        <h1 style={styles.headerTitle}>Tasks</h1>
        <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>{guilds[guildId ?? ""]?.name ?? ""}</span>
      </div>

      <div style={styles.tabBar}>
        <span style={view === "mine" ? styles.tabActive : styles.tab} onClick={() => setView("mine")}>My tasks ({counts.mine})</span>
        <span style={view === "open" ? styles.tabActive : styles.tab} onClick={() => setView("open")}>All open ({counts.open})</span>
        <span style={view === "unassigned" ? styles.tabActive : styles.tab} onClick={() => setView("unassigned")}>Unassigned ({counts.unassigned})</span>
        <span style={view === "closed" ? styles.tabActive : styles.tab} onClick={() => setView("closed")}>Closed ({counts.closed})</span>
        <span style={{ marginLeft: "auto", marginRight: "var(--content-pad)", display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
          <Select
            size="small"
            mode="multiple"
            allowClear
            placeholder="Channel"
            value={channelFilter}
            onChange={setChannelFilter}
            style={{ minWidth: 160 }}
            options={channels.filter((c) => c.type !== 11).map((c) => ({ label: `#${c.name}`, value: c.id }))}
            maxTagCount="responsive"
          />
          <Select
            size="small"
            value={groupBy}
            onChange={setGroupBy}
            style={{ width: 120 }}
            options={[
              { label: "Group: channel", value: "channel" },
              { label: "Group: assignee", value: "assignee" },
              { label: "Flat list", value: "none" },
            ]}
          />
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => guildId && fetchGuildTasks(guildId)}
            title="Refresh"
          />
        </span>
      </div>

      {selectedRowKeys.length > 0 && (
        <div style={styles.toolbar}>
          <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>{selectedRowKeys.length} selected</span>
          <Popconfirm
            title={`Mark ${selectedRowKeys.length} task(s) done?`}
            onConfirm={() => applyBatch({ status: "done" })}
            okText="Mark done"
          >
            <Button size="small" icon={<CheckOutlined />} loading={batchBusy} disabled={batchBusy}>Mark done</Button>
          </Popconfirm>
          <Select
            size="small"
            placeholder="Reassign to…"
            allowClear
            disabled={batchBusy}
            style={{ minWidth: 160 }}
            options={members.map((m) => ({ label: m.nick || m.user.global_name || m.user.username, value: m.user.id }))}
            onChange={(value) => {
              if (value) applyBatch({ assignee_id: value });
            }}
          />
          <Button type="text" size="small" onClick={() => setSelectedRowKeys([])} disabled={batchBusy}>Clear</Button>
        </div>
      )}

      <div style={styles.content} className="scroll-container">
        {loading && grouped.length === 0 && (
          <div style={styles.empty}>Loading tasks…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={styles.empty}>
            <InboxOutlined style={{ fontSize: "var(--icon-emoji-size)", color: "var(--text-muted)" }} />
            <span>No tasks here</span>
          </div>
        )}
        {grouped.map((group) => (
          <div key={group.key}>
            {group.label !== null && (
              <div style={styles.groupHeader}>
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "var(--accent, #5865f2)" }} />
                {group.label}
                <span style={{ opacity: 0.6 }}>({group.tasks.length})</span>
              </div>
            )}
            <Table<Task>
              columns={columns}
              dataSource={group.tasks}
              rowKey="task_id"
              size="small"
              pagination={false}
              loading={loading}
              rowSelection={{
                selectedRowKeys,
                onChange: setSelectedRowKeys,
                preserveSelectedRowKeys: true,
              }}
              locale={{ emptyText: "No tasks" }}
              scroll={{ x: "max-content" }}
              rowClassName={(record) => (record.thread_id === selectedThreadId ? "task-row-active-thread" : "")}
              onRow={(record) => ({
                onClick: (e) => {
                  const target = e.target as HTMLElement;
                  // Let interactive cells (links, selects, checkboxes, buttons) handle their own clicks.
                  if (target.closest("input, button, a, .ant-select, .ant-checkbox-wrapper, .ant-checkbox")) return;
                  handleOpenThread(record);
                },
              })}
            />
          </div>
        ))}
      </div>
      </div>
      {selectedThreadId && (
        <>
          <div
            style={{
              width: 4,
              flexShrink: 0,
              cursor: "col-resize",
              background: resizeDragging ? "var(--accent)" : undefined,
              transition: "background 0.15s",
            }}
            onMouseDown={handleResizeMouseDown}
            onMouseEnter={(e) => { if (!resizeDragging) (e.currentTarget.style.background = "var(--border-subtle)"); }}
            onMouseLeave={(e) => { if (!resizeDragging) (e.currentTarget.style.background = ""); }}
          />
          <div style={{ width: threadPanelWidth, flexShrink: 0, display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-secondary)", borderLeft: "1px solid var(--border-subtle)" }}>
            <ThreadPanel threadId={selectedThreadId} onClose={closeThread} />
          </div>
        </>
      )}
      {editingTask && (
        <TaskEditDialog key={editingTask.task_id} task={editingTask} open onClose={() => setEditingTask(null)} />
      )}
    </div>
  );
}
