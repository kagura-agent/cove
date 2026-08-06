import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { useActiveIds } from "../hooks/useActiveIds";
import { useChannelStore } from "../stores/useChannelStore";
import { useThreadStore } from "../stores/useThreadStore";
import { useChannelFilesStore } from "../stores/useChannelFilesStore";
import { ChatArea } from "./ChatArea";
import { MessageInput } from "./MessageInput";
import { ReplyBar } from "./ReplyBar";
import { MemberList } from "./MemberList";
import { FilesSidebar } from "./FilesSidebar";
import { TaskPanel } from "./TaskPanel";
import { CreateTaskDialog } from "./CreateTaskDialog";
import { ThreadPanel } from "./ThreadPanel";
import { routes } from "../lib/routes";
import type { CSSProperties } from "react";

interface AppShellContext {
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
}

type ChannelTab = "chat" | "tasks" | "files" | "threads";

const styles = {
  chatColumn: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 } as CSSProperties,
  chatBody: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", background: "var(--bg-primary)" } as CSSProperties,
  chatFooter: { flexShrink: 0, minHeight: "var(--footer-height)", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + var(--keyboard-offset, 0px))", background: "var(--bg-secondary)" } as CSSProperties,
  tabBar: { display: "flex", alignItems: "center", gap: 0, background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)", paddingLeft: "var(--content-pad)" } as CSSProperties,
  tab: { padding: "8px 16px", fontSize: "var(--font-size-sm)", fontWeight: 500, cursor: "pointer", color: "var(--text-muted)", borderBottom: "2px solid transparent", transition: "color 0.15s, border-color 0.15s" } as CSSProperties,
  tabActive: { padding: "8px 16px", fontSize: "var(--font-size-sm)", fontWeight: 600, cursor: "pointer", color: "var(--header-primary)", borderBottom: "2px solid var(--accent, #5865f2)", transition: "color 0.15s, border-color 0.15s" } as CSSProperties,
  mobileMembersBackdrop: { position: "fixed", inset: 0, background: "var(--bg-overlay-strong)", zIndex: 20, opacity: 0, pointerEvents: "none" as const, transition: "opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)" } as CSSProperties,
  mobileMembersBackdropVisible: { opacity: 1, pointerEvents: "auto" as const } as CSSProperties,
  membersOpenWrapper: { display: "contents" } as CSSProperties,
};

export function ChannelView() {
  const { sidebarOpen, setSidebarOpen } = useOutletContext<AppShellContext>();
  const { guildId, channelId, threadId } = useActiveIds();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const channelsLoaded = useChannelStore((s) => s.channelsLoaded);
  const [membersOpen, setMembersOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const setFilesStoreOpen = useChannelFilesStore((s) => s.setFilesOpen);
  const [threadPanelWidth, setThreadPanelWidth] = useState(400);
  const [resizeDragging, setResizeDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(400);

  // Tab state via URL query param
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as ChannelTab) || "chat";
  const setActiveTab = useCallback((tab: ChannelTab) => {
    setSearchParams((prev) => {
      if (tab === "chat") prev.delete("tab");
      else prev.set("tab", tab);
      return prev;
    }, { replace: true });
  }, [setSearchParams]);

  // Sync files store open state with tab
  useEffect(() => {
    setFilesStoreOpen(activeTab === "files");
  }, [activeTab, setFilesStoreOpen]);

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
      if (threadFetchRef.current === threadId) return;
      threadFetchRef.current = threadId;
      useThreadStore.getState().fetchThread(threadId).then((thread) => {
        if (!thread && guildId && channelId) {
          navigateRef.current(routes.channel(guildId, channelId), { replace: true });
        }
      }).catch(() => {
        if (guildId && channelId) {
          navigateRef.current(routes.channel(guildId, channelId), { replace: true });
        }
      });
    }
  }, [threadId, channelId, guildId, channelsLoaded]);

  const closeThread = useCallback(() => {
    if (!guildId || !channelId) return;
    // Always navigate to current channel, preserving the active tab
    const tabParam = searchParams.get("tab");
    const url = routes.channel(guildId, channelId) + (tabParam ? `?tab=${tabParam}` : "");
    navigateRef.current(url, { replace: true });
  }, [guildId, channelId, searchParams]);

  const toggleMembers = () => setMembersOpen((open) => !open);

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
            onMembersClick={toggleMembers}
            membersOpen={membersOpen}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onNewTask={() => setCreateTaskOpen(true)}
          />
        </div>
        {activeTab === "chat" && (
          <div style={styles.chatFooter} className="chat-footer-cell">
            {channelId && <ReplyBar channelId={channelId} />}
            {channelId && <MessageInput channelId={channelId} />}
          </div>
        )}
      </div>

      <div
        className="mobile-members-backdrop"
        onClick={() => setMembersOpen(false)}
        style={{ ...styles.mobileMembersBackdrop, ...(membersOpen ? styles.mobileMembersBackdropVisible : {}) }}
      />
      {membersOpen && (
        <div className="members-open" style={styles.membersOpenWrapper}>
          <MemberList />
        </div>
      )}
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
            <ThreadPanel threadId={threadId} onClose={closeThread} onMembersClick={toggleMembers} membersOpen={membersOpen} />
          </div>
        </>
      )}
      {createTaskOpen && channelId && (
        <CreateTaskDialog
          channelId={channelId}
          open={createTaskOpen}
          onClose={() => setCreateTaskOpen(false)}
        />
      )}
    </>
  );
}
