import { useState } from "react";
import { Outlet } from "react-router-dom";
import { useWebSocketStore } from "./stores/useWebSocketStore";
import { useChannelStore } from "./stores/useChannelStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { Sidebar } from "./components/Sidebar";
import { GuildSidebar } from "./components/GuildSidebar";
import { UserBar } from "./components/UserBar";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { SettingsPanel } from "./components/SettingsPanel";
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
  const wsStatus = useWebSocketStore((s) => s.status);
  const channelsLoaded = useChannelStore((s) => s.channelsLoaded);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const settingsOpen = useSettingsStore((s) => s.open);
  const closeSettings = useSettingsStore((s) => s.close);
  const openSettings = useSettingsStore((s) => s.openSettings);

  return (
    <div style={styles.fullHeight}>
      <ConnectionBanner status={wsStatus} />
      <div onClick={() => setSidebarOpen(false)} style={{...styles.overlay, ...(sidebarOpen ? styles.overlayVisible : {})}} className="mobile-sidebar-backdrop" />

      <div style={styles.layout} className={`app-layout ${sidebarOpen ? "sidebar-open" : ""}`}>
        <GuildSidebar />

        <div style={styles.sidebarColumn} className="sidebar-column">
          <Sidebar onClose={() => setSidebarOpen(false)} loading={!channelsLoaded} style={styles.sidebarBody} />
          <div style={styles.sidebarFooter} className="sidebar-footer-cell">
            <UserBar onCloseSidebar={() => setSidebarOpen(false)} onSettingsOpen={openSettings} />
          </div>
        </div>

        <Outlet context={{ sidebarOpen, setSidebarOpen }} />
      </div>

      <SettingsPanel open={settingsOpen} onOpenChange={(v) => { if (!v) closeSettings(); }} />
    </div>
  );
}
