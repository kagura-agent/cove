import { useEffect, useState, useCallback } from "react";
import { ConfigProvider, theme, Button, Input, message } from "antd";
import { GoogleOutlined } from "@ant-design/icons";
import { useUserStore } from "./stores/useUserStore";
import { useChannelStore } from "./stores/useChannelStore";
import { useWebSocketStore } from "./stores/useWebSocketStore";
import { useThemeStore } from "./stores/useThemeStore";
import { Sidebar } from "./components/Sidebar";
import { ChatArea } from "./components/ChatArea";
import { UserBar } from "./components/UserBar";
import { MessageInput } from "./components/MessageInput";
import { MemberList } from "./components/MemberList";
import { SettingsPanel } from "./components/SettingsPanel";
import * as api from "./lib/api";
import { setupGatewaySubscriptions, teardownGatewaySubscriptions } from "./lib/gateway-subscriptions";
import { API_PREFIX } from "@cove/shared";
import type { CSSProperties } from "react";

function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const offset = window.innerHeight - vv.height;
      document.documentElement.style.setProperty("--keyboard-offset", `${Math.max(0, offset)}px`);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.documentElement.style.setProperty("--keyboard-offset", "0px");
    };
  }, []);
}

function useAntdThemeConfig() {
  const currentTheme = useThemeStore((s) => s.theme);
  // Read --accent-brand from CSS so Antd stays in sync with our token system
  const accentBrand = getComputedStyle(document.documentElement).getPropertyValue("--accent-brand").trim() || "#f4a261";
  return {
    algorithm: currentTheme === "light" ? theme.defaultAlgorithm : theme.darkAlgorithm,
    token: { colorPrimary: accentBrand, colorBgContainer: "var(--bg-secondary)", colorBgElevated: "var(--bg-tertiary)" },
  };
}

const styles = {
  fullHeight: { height: "100%", background: "var(--bg-primary)" } as CSSProperties,
  overlay: { position: "fixed", inset: 0, background: "var(--bg-overlay-strong)", zIndex: 20, opacity: 0, pointerEvents: "none" as const, transition: "opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)" } as CSSProperties,
  overlayVisible: { opacity: 1, pointerEvents: "auto" as const } as CSSProperties,
  layout: { display: "grid", gridTemplateRows: "1fr minmax(var(--footer-height), auto)", height: "100%", overflow: "hidden" } as CSSProperties,
  sidebarBody: { gridColumn: 1, gridRow: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", background: "var(--bg-secondary)" } as CSSProperties,
  sidebarFooter: { gridColumn: 1, gridRow: 2 } as CSSProperties,
  chatBody: { gridColumn: 2, gridRow: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden", background: "var(--bg-primary)" } as CSSProperties,
  chatFooter: { gridColumn: 2, gridRow: 2, paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + var(--keyboard-offset, 0px))", background: "var(--bg-secondary)" } as CSSProperties,
  connStatus: { display: "flex", alignItems: "center", gap: "var(--space-xs)", padding: "var(--space-xs) var(--space-md)", fontSize: "var(--font-size-sm)", color: "var(--text-muted)", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)" } as CSSProperties,
  loginPage: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "var(--space-xxl)" } as CSSProperties,
  loginTitle: { fontSize: "var(--font-size-xxl)", fontWeight: 700, color: "var(--accent-brand)" } as CSSProperties,
};

const connDot = (status: string): CSSProperties => ({
  width: "var(--status-dot-size)", height: "var(--status-dot-size)", borderRadius: "50%", display: "inline-block",
  background: status === "connecting" ? "var(--warning)" : "var(--danger)",
});

const API_BASE = import.meta.env.VITE_COVE_API_URL ?? "";

function InviteCodePage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}${API_PREFIX}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: code.trim().toUpperCase() }),
        credentials: "include", // BFF: send/receive cookies
      });
      if (!res.ok) {
        setError(res.status === 400 ? "Invalid or already used invite code" : "Something went wrong, please try again");
        return;
      }
      // Server sets session cookie — just reload
      window.history.replaceState({}, "", "/");
      window.location.reload();
    } catch {
      setError("Network error, please try again");
    } finally {
      setLoading(false);
    }
  }, [code]);

  return (
    <div style={styles.loginPage}>
      <div style={styles.loginTitle}>Cove</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 300 }}>
        <Input
          placeholder="Enter invite code (COVE-XXXX-XXXX)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onPressEnter={handleSubmit}
          size="large"
          style={{ textAlign: "center", letterSpacing: 1 }}
        />
        <Button type="primary" size="large" onClick={handleSubmit} loading={loading}>
          Submit
        </Button>
        {error && <div style={{ color: "var(--danger)", textAlign: "center" }}>{error}</div>}
      </div>
    </div>
  );
}

function LoginPage() {
  return (
    <div style={styles.loginPage}>
      <div style={styles.loginTitle}>Cove</div>
      <Button
        type="primary"
        size="large"
        icon={<GoogleOutlined />}
        onClick={() => { window.location.href = `${API_BASE}/api/auth/google`; }}
      >
        Sign in with Google
      </Button>
    </div>
  );
}

export default function App() {
  const themeConfig = useAntdThemeConfig();
  useVisualViewport();
  const { needsSetup, setUser } = useUserStore();
  const { activeChannelId, setChannels, setActiveChannel } = useChannelStore();
  const connect = useWebSocketStore((s) => s.connect);
  const wsStatus = useWebSocketStore((s) => s.status);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(true);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    // BFF: tokens are in HttpOnly cookies, not URL or localStorage
    // Clean up legacy localStorage tokens (still valid in DB, XSS risk)
    localStorage.removeItem("cove-token");
    localStorage.removeItem("cove-user");

    // Clean up any URL params that might appear from old bookmarks
    const params = new URLSearchParams(window.location.search);
    if (params.has("token") || params.has("pending")) {
      window.history.replaceState({}, "", "/");
    }

    // Check if user has a pending registration (cookie-based)
    api.fetchPendingStatus()
      .then((status) => {
        if (status.pending) {
          setIsPending(true);
          setAuthLoading(false);
          return;
        }
        // Not pending — try to fetch authenticated user
        return api.fetchMe()
          .then((user) => {
            setUser(user);
          })
          .catch(() => {
            // No valid session cookie
            useUserStore.setState({ needsSetup: true });
          });
      })
      .catch(() => {
        // Server unreachable or error — show login
        useUserStore.setState({ needsSetup: true });
      })
      .finally(() => setAuthLoading(false));
  }, [setUser]);

  useEffect(() => {
    if (needsSetup || authLoading) return;
    setChannelsLoading(true);
    api.fetchChannels().then((chs) => {
      setChannels(chs);
      if (chs.length > 0) setActiveChannel(chs[0].id);
    }).catch(() => message.error("Failed to load channels"))
      .finally(() => setChannelsLoading(false));
    setupGatewaySubscriptions();
    connect();
    return () => {
      teardownGatewaySubscriptions();
    };
  }, [needsSetup, authLoading, setChannels, setActiveChannel, connect]);

  if (authLoading) {
    return (
      <ConfigProvider theme={themeConfig}>
        <div style={{ ...styles.fullHeight, ...styles.loginPage }}>
          <div style={styles.loginTitle}>Cove</div>
        </div>
      </ConfigProvider>
    );
  }

  if (isPending) {
    return (
      <ConfigProvider theme={themeConfig}>
        <div style={styles.fullHeight}>
          <InviteCodePage />
        </div>
      </ConfigProvider>
    );
  }

  if (needsSetup) {
    return (
      <ConfigProvider theme={themeConfig}>
        <div style={styles.fullHeight}>
          <LoginPage />
        </div>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider theme={themeConfig}>
      <div style={styles.fullHeight}>
        <div onClick={() => setSidebarOpen(false)} style={{...styles.overlay, ...(sidebarOpen ? styles.overlayVisible : {})}} className="mobile-sidebar-backdrop" />
        <div onClick={() => setMembersOpen(false)} style={{...styles.overlay, ...(membersOpen ? styles.overlayVisible : {})}} className="mobile-members-backdrop" />

        <div style={{ ...styles.layout, gridTemplateColumns: membersOpen ? "var(--sidebar-width) 1fr var(--member-list-width)" : "var(--sidebar-width) 1fr" }} className={`app-layout ${sidebarOpen ? "sidebar-open" : ""} ${membersOpen ? "members-open" : ""}`}>
          <Sidebar onClose={() => setSidebarOpen(false)} loading={channelsLoading} style={styles.sidebarBody} />
          <div style={styles.sidebarFooter} className="sidebar-footer-cell">
            <UserBar onCloseSidebar={() => setSidebarOpen(false)} onSettingsOpen={() => setSettingsOpen(true)} />
          </div>

          <div style={styles.chatBody} className="chat-body-cell">
            {wsStatus !== "connected" && (
              <div style={styles.connStatus}>
                <span style={connDot(wsStatus)} />
                <span>{wsStatus === "connecting" ? "Connecting..." : "Disconnected"}</span>
              </div>
            )}
            <ChatArea onMenuClick={() => setSidebarOpen(!sidebarOpen)} onMembersClick={() => setMembersOpen(!membersOpen)} membersOpen={membersOpen} />
          </div>
          <div style={styles.chatFooter} className="chat-footer-cell">
            {activeChannelId && <MessageInput channelId={activeChannelId} />}
          </div>

          {membersOpen && <MemberList />}
        </div>

        <SettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} />
      </div>
    </ConfigProvider>
  );
}
