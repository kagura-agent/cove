import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { useActiveIds } from "../hooks/useActiveIds";
import { useChannelStore } from "../stores/useChannelStore";
import { useThreadStore } from "../stores/useThreadStore";
import { useChannelFilesStore } from "../stores/useChannelFilesStore";
import { ChatArea } from "./ChatArea";
import { MessageInput } from "./MessageInput";
import { ReplyBar } from "./ReplyBar";
import { MemberList } from "./MemberList";
import { FilesSidebar } from "./FilesSidebar";
import { ThreadPanel } from "./ThreadPanel";
import { routes } from "../lib/routes";
import type { CSSProperties } from "react";

interface AppShellContext {
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
}

const styles = {
  chatColumn: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 } as CSSProperties,
  chatBody: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", background: "var(--bg-primary)" } as CSSProperties,
  chatFooter: { flexShrink: 0, minHeight: "var(--footer-height)", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + var(--keyboard-offset, 0px))", background: "var(--bg-secondary)" } as CSSProperties,
};

export function ChannelView() {
  const { sidebarOpen, setSidebarOpen } = useOutletContext<AppShellContext>();
  const { guildId, channelId, threadId } = useActiveIds();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const channelsLoaded = useChannelStore((s) => s.channelsLoaded);
  const [membersOpen, setMembersOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const setFilesStoreOpen = useChannelFilesStore((s) => s.setFilesOpen);
  const [threadPanelWidth, setThreadPanelWidth] = useState(400);
  const [resizeDragging, setResizeDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(400);

  // Validate channel exists after data loads
  useEffect(() => {
    if (!channelsLoaded || !guildId || !channelId) return;
    const channels = useChannelStore.getState().channelsByGuildId[guildId] ?? [];
    const channelExists = channels.some((c) => c.id === channelId);
    if (!channelExists) {
      navigateRef.current(routes.root(), { replace: true });
    }
  }, [channelsLoaded, guildId, channelId]);

  // Validate thread exists
  const threadFetchRef = useRef<string | null>(null);
  useEffect(() => {
    if (!threadId || !channelId) return;
    const channelThreads = useThreadStore.getState().threads[channelId] ?? [];
    const threadExists = channelThreads.some((t) => t.id === threadId);
    if (channelsLoaded && !threadExists) {
      // Guard: don't re-fetch if already in progress or completed for this threadId
      if (threadFetchRef.current === threadId) return;
      threadFetchRef.current = threadId;
      // Thread not found — try to fetch it (deep link case)
      useThreadStore.getState().fetchThread(threadId).then((thread) => {
        if (!thread && guildId && channelId) {
          navigateRef.current(routes.channel(guildId, channelId), { replace: true });
        }
      }).catch(() => {
        // Network failure — navigate back to parent channel
        if (guildId && channelId) {
          navigateRef.current(routes.channel(guildId, channelId), { replace: true });
        }
      });
    }
  }, [threadId, channelId, guildId, channelsLoaded]);

  const closeThread = useCallback(() => {
    if (!guildId || !channelId) return;
    if (window.history.state?.idx === 0) {
      navigateRef.current(routes.channel(guildId, channelId), { replace: true });
    } else {
      navigateRef.current(-1);
    }
  }, [guildId, channelId]);

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

  return (
    <>
      <div style={styles.chatColumn} className="chat-column">
        <div style={styles.chatBody} className="chat-body-cell">
          <ChatArea
            onMenuClick={() => setSidebarOpen(!sidebarOpen)}
            onMembersClick={() => {
              const next = !membersOpen;
              setMembersOpen(next);
              if (next) { setFilesOpen(false); setFilesStoreOpen(false); }
            }}
            membersOpen={membersOpen}
            onFilesClick={() => {
              const next = !filesOpen;
              setFilesOpen(next);
              setFilesStoreOpen(next);
              if (next) setMembersOpen(false);
            }}
            filesOpen={filesOpen}
          />
        </div>
        <div style={styles.chatFooter} className="chat-footer-cell">
          {channelId && <ReplyBar channelId={channelId} />}
          {channelId && <MessageInput channelId={channelId} />}
        </div>
      </div>

      {!threadId && membersOpen && <MemberList />}
      {!threadId && filesOpen && channelId && <FilesSidebar channelId={channelId} />}
      {threadId && (
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
            <ThreadPanel threadId={threadId} onClose={closeThread} />
          </div>
        </>
      )}
    </>
  );
}
