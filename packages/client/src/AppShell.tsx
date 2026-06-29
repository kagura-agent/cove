import { useState } from "react";
import { Outlet } from "react-router-dom";
import { useWebSocketStore } from "./stores/useWebSocketStore";
import { useGuildStore } from "./stores/useGuildStore";
import { useChannelStore } from "./stores/useChannelStore";
import { Sidebar } from "./components/Sidebar";
import { GuildSidebar } from "./components/GuildSidebar";
import { UserBar } from "./components/UserBar";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { SettingsPanel } from "./components/SettingsPanel";
import { useActiveIds } from "./hooks/useActiveIds";
import type { CSSProperties } from "react";

const styles = {
  fullHeight: { height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-primary)" } as CSSProperties,
  overlay: { position: "fixed", inset: 0, background: "var(--bg-overlay-strong)", zIndex: 20, opacity: 0, pointerEvents: "none" as const, transition: "opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)" } as CSSProperties,
  overlayVisible: { opacity: 1, pointerEvents: "auto" as const } as CSSProperties,
  layout: { display: "flex", flex: 1, minHeight: 0, overflow: "hidden" } as CSSProperties,
  sidebarColumn: { width: "var(--sidebar-width)", flexShrink: 0, display: "flex", flexDirection: "column", minHeight: 0, background: "var(--bg-secondary)" } as CSSProperties,
  sidebarBody: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" } as CSSProperties,
  sidebarFooter: { flexShrink: 0, minHeight: "var(--footer-height)" } as CSSProperties,
};

export function AppShell() {
  const { guildId } = useActiveIds();
  const wsStatus = useWebSocketStore((s) => s.status);
  const channelsLoaded = useChannelStore((s) => s.channelsLoaded);
  const serverName = useGuildStore((s) => {
    return guildId ? s.guilds[guildId]?.name ?? "" : "";
  });
  const serverIcon = useGuildStore((s) => {
    return guildId ? s.guilds[guildId]?.icon ?? null : null;
  });

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div style={styles.fullHeight}>
      <ConnectionBanner status={wsStatus} serverName={serverName} serverIcon={serverIcon} />
      <div onClick={() => setSidebarOpen(false)} style={{...styles.overlay, ...(sidebarOpen ? styles.overlayVisible : {})}} className="mobile-sidebar-backdrop" />

      <div style={styles.layout} className={`app-layout ${sidebarOpen ? "sidebar-open" : ""}`}>
        <GuildSidebar />

        <div style={styles.sidebarColumn} className="sidebar-column">
          <Sidebar onClose={() => setSidebarOpen(false)} loading={!channelsLoaded} style={styles.sidebarBody} />
          <div style={styles.sidebarFooter} className="sidebar-footer-cell">
            <UserBar onCloseSidebar={() => setSidebarOpen(false)} onSettingsOpen={() => setSettingsOpen(true)} />
          </div>
        </div>

        <Outlet context={{ sidebarOpen, setSidebarOpen }} />
      </div>

      <SettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
