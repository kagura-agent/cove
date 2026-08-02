import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useChannelStore } from "../stores/useChannelStore";
import { useMessageStore } from "../stores/useMessageStore";
import { useActiveIds } from "../hooks/useActiveIds";
import { useTaskStore } from "../stores/useTaskStore";
import { useChannelFilesStore } from "../stores/useChannelFilesStore";
import { Typography, Button, Popconfirm } from "antd";
import { MenuOutlined, DeleteOutlined, TeamOutlined } from "@ant-design/icons";
import { MessageList } from "./MessageList";
import { ThreadBrowser } from "./ThreadBrowser";
import { routes } from "../lib/routes";
import * as api from "../lib/api";
import type { CSSProperties } from "react";
import type { Task, TaskStatus } from "@cove/shared";
import { ChatMarkdown } from "./ChatMarkdown";
import { ThreadIcon } from "./ThreadIcon";
import { FilesSidebar } from "./FilesSidebar";

type ChannelTab = "chat" | "tasks" | "files";

const STATUS_COLORS: Record<TaskStatus, string> = {
  open: "var(--text-muted)",
  in_progress: "#5865f2",
  in_review: "#e67e22",
  done: "#3ba55c",
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

const styles = {
  empty: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", gap: "var(--space-md)", opacity: 0.6 } as CSSProperties,
  wrapper: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden" } as CSSProperties,
  header: { display: "flex", alignItems: "center", gap: "var(--content-gap)", padding: "0 var(--content-pad)", paddingTop: "env(safe-area-inset-top, 0px)", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)", height: "var(--header-height)", flexShrink: 0 } as CSSProperties,
  menuBtn: { color: "var(--text-normal)" } as CSSProperties,
  clearBtn: { color: "var(--interactive-normal)", opacity: 0.5 } as CSSProperties,
  membersBtn: { color: "var(--interactive-normal)" } as CSSProperties,
  membersBtnActive: { color: "var(--interactive-active)" } as CSSProperties,
  tabBar: { display: "flex", alignItems: "center", gap: 0, background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)", paddingLeft: "var(--content-pad)", flexShrink: 0 } as CSSProperties,
  tab: { padding: "8px 16px", fontSize: "var(--font-size-sm)", fontWeight: 500, cursor: "pointer", color: "var(--text-muted)", borderBottom: "2px solid transparent", transition: "color 0.15s, border-color 0.15s", userSelect: "none" } as CSSProperties,
  tabActive: { padding: "8px 16px", fontSize: "var(--font-size-sm)", fontWeight: 600, cursor: "pointer", color: "var(--header-primary)", borderBottom: "2px solid var(--accent, #5865f2)", transition: "color 0.15s, border-color 0.15s", userSelect: "none" } as CSSProperties,
  taskList: { flex: 1, overflowY: "auto", padding: "var(--space-md)" } as CSSProperties,
  taskItem: { display: "flex", alignItems: "center", gap: "var(--space-sm)", padding: "var(--space-sm) var(--space-md)", borderRadius: "var(--space-xs)", cursor: "pointer", transition: "background 0.15s", fontSize: "var(--font-size-md)", color: "var(--text-normal)" } as CSSProperties,
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
  const setMessages = useMessageStore((s) => s.setMessages);
  const channel = channels.find((c) => c.id === channelId);
  const [threadBrowserOpen, setThreadBrowserOpen] = useState(false);

  async function handleClear() {
    if (!channel) return;
    try {
      await api.clearMessages(channel.id);
      setMessages(channel.id, []);
    } catch (err) { console.error("clear:", err); }
  }

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
        {activeTab === "chat" && (
          <Popconfirm title="Clear all messages in this channel?" onConfirm={handleClear} okText="Clear" cancelText="Cancel" okButtonProps={{ danger: true }}>
            <Button type="text" icon={<DeleteOutlined />} style={styles.clearBtn} />
          </Popconfirm>
        )}
        {activeTab === "chat" && (
          <Button type="text" icon={<ThreadIcon size={16} />} onClick={() => setThreadBrowserOpen(!threadBrowserOpen)} style={threadBrowserOpen ? styles.membersBtnActive : styles.membersBtn} />
        )}
        {onMembersClick && <Button type="text" icon={<TeamOutlined />} onClick={onMembersClick} style={membersOpen ? styles.membersBtnActive : styles.membersBtn} />}
      </div>

      {/* Tab bar */}
      <div style={styles.tabBar}>
        <span style={activeTab === "chat" ? styles.tabActive : styles.tab} onClick={() => onTabChange("chat")}>Chat</span>
        <span style={activeTab === "tasks" ? styles.tabActive : styles.tab} onClick={() => onTabChange("tasks")}>Tasks</span>
        <span style={activeTab === "files" ? styles.tabActive : styles.tab} onClick={() => onTabChange("files")}>Files</span>
        {activeTab === "tasks" && (
          <button style={styles.newTaskBtn} onClick={onNewTask}>+ New Task</button>
        )}
      </div>

      {/* Tab content */}
      {activeTab === "chat" && (
        <>
          <MessageList channelId={channel.id} />
          {threadBrowserOpen && <ThreadBrowser channelId={channel.id} onClose={() => setThreadBrowserOpen(false)} />}
        </>
      )}
      {activeTab === "tasks" && channelId && <InlineTaskList channelId={channelId} />}
      {activeTab === "files" && channelId && (
        <div style={styles.filesContainer}>
          <FilesSidebar channelId={channelId} inline />
        </div>
      )}
    </div>
  );
}

/** Inline task list for the Tasks tab */
function InlineTaskList({ channelId }: { channelId: string }) {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { guildId } = useActiveIds();
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const byTaskId = useTaskStore((s) => s.byTaskId);
  const tasks = useMemo(() => Object.values(byTaskId).filter((t) => t.channel_id === channelId), [byTaskId, channelId]);

  useEffect(() => {
    setLoading(true);
    fetchTasks(channelId).finally(() => setLoading(false));
  }, [channelId, fetchTasks]);

  function handleClick(task: Task) {
    if (guildId) navigate(routes.thread(guildId, channelId, task.thread_id));
  }

  return (
    <div style={styles.taskList} className="scroll-container">
      {loading && (
        <div style={{ textAlign: "center", padding: "var(--space-xl)", color: "var(--text-muted)" }}>Loading...</div>
      )}
      {!loading && tasks.length === 0 && (
        <div style={{ textAlign: "center", padding: "var(--space-xl)", color: "var(--text-muted)" }}>
          No tasks yet. Click "+ New Task" to create one.
        </div>
      )}
      {tasks.map((t) => (
        <div
          key={t.task_id}
          style={styles.taskItem}
          onClick={() => handleClick(t)}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-modifier-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: STATUS_COLORS[t.status], flexShrink: 0 }} />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
          <span style={{ fontSize: "var(--font-size-xs)", padding: "2px 8px", borderRadius: 10, fontWeight: 600, color: "#fff", background: STATUS_COLORS[t.status] }}>
            {STATUS_LABELS[t.status]}
          </span>
          <span style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>#{t.seq}</span>
        </div>
      ))}
    </div>
  );
}
