import { useChannelStore } from "../stores/useChannelStore";
import { useMessageStore } from "../stores/useMessageStore";
import { Typography, Button, Popconfirm } from "antd";
import { MenuOutlined, DeleteOutlined, TeamOutlined } from "@ant-design/icons";
import { MessageList } from "./MessageList";
import * as api from "../lib/api";
import type { CSSProperties } from "react";
import { ChatMarkdown } from "./ChatMarkdown";

const styles = {
  empty: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", gap: "var(--space-md)", opacity: 0.6 } as CSSProperties,
  wrapper: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden" } as CSSProperties,
  header: { display: "flex", alignItems: "center", gap: "var(--content-gap)", padding: "0 var(--content-pad)", paddingTop: "env(safe-area-inset-top, 0px)", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)", height: "var(--header-height)", flexShrink: 0 } as CSSProperties,
  menuBtn: { color: "var(--text-normal)" } as CSSProperties,
  clearBtn: { color: "var(--interactive-normal)", opacity: 0.5 } as CSSProperties,
  membersBtn: { color: "var(--interactive-normal)" } as CSSProperties,
  membersBtnActive: { color: "var(--interactive-active)" } as CSSProperties,
};

export function ChatArea({ onMenuClick, onMembersClick, membersOpen }: { onMenuClick?: () => void; onMembersClick?: () => void; membersOpen?: boolean }) {
  const { channels, activeChannelId } = useChannelStore();
  const setMessages = useMessageStore((s) => s.setMessages);
  const channel = channels.find((c) => c.id === activeChannelId);

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
        <span style={{ fontSize: "var(--avatar-size)" }}>🌴</span>
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
        <Popconfirm title="Clear all messages in this channel?" onConfirm={handleClear} okText="Clear" cancelText="Cancel" okButtonProps={{ danger: true }}>
          <Button type="text" icon={<DeleteOutlined />} style={styles.clearBtn} />
        </Popconfirm>
        {onMembersClick && <Button type="text" icon={<TeamOutlined />} onClick={onMembersClick} style={membersOpen ? styles.membersBtnActive : styles.membersBtn} />}
      </div>
      <MessageList channelId={channel.id} />
    </div>
  );
}
