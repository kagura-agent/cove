import { useEffect, useState, useCallback } from "react";
import { RouterProvider } from "react-router-dom";
import { ConfigProvider, theme } from "antd";
import "./onboarding.css";

import { useUserStore } from "./stores/useUserStore";
import { useChannelStore } from "./stores/useChannelStore";
import { useGuildStore } from "./stores/useGuildStore";
import { useWebSocketStore } from "./stores/useWebSocketStore";
import { useThemeStore } from "./stores/useThemeStore";
import { router, getActiveIdsFromRouter } from "./lib/router";
import { routes } from "./lib/routes";
import { setupGatewaySubscriptions, teardownGatewaySubscriptions } from "./lib/gateway-subscriptions";
import * as api from "./lib/api";
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
  const accentBrand = getComputedStyle(document.documentElement).getPropertyValue("--accent-brand").trim() || "#f4a261";
  return {
    algorithm: currentTheme === "light" ? theme.defaultAlgorithm : theme.darkAlgorithm,
    token: { colorPrimary: accentBrand, colorBgContainer: "var(--bg-secondary)", colorBgElevated: "var(--bg-tertiary)" },
  };
}

const styles = {
  fullHeight: { height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-primary)" } as CSSProperties,
  loginPage: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "var(--space-xxl)" } as CSSProperties,
  loginTitle: { fontSize: "var(--font-size-xxl)", fontWeight: 700, color: "var(--accent-brand)" } as CSSProperties,
};

const API_BASE = import.meta.env.VITE_COVE_API_URL ?? "";

function InviteCodePage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!code.trim()) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}${API_PREFIX}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: code.trim().toUpperCase() }),
        credentials: "include",
      });
      if (!res.ok) {
        setError(res.status === 400 ? "Invalid or already used invite code" : "Something went wrong, please try again");
        return;
      }
      window.location.reload();
    } catch {
      setError("Network error, please try again");
    } finally {
      setLoading(false);
    }
  }, [code]);

  return (
    <div className="ob-page">
      <div className="ob-login-card">
        <h2 className="ob-code-title">Enter invite code</h2>
        <p className="ob-code-desc">Cove is in early access. Enter your invite code to continue.</p>
        <div className="ob-code-row">
          <input
            className="ob-code-input"
            placeholder="COVE-XXXX-XXXX"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
          <button className="ob-code-btn" onClick={handleSubmit} disabled={loading}>→</button>
        </div>
        {error && <p className="ob-error">{error}</p>}
      </div>
    </div>
  );
}

function CreateCovePage() {
  const [mode, setMode] = useState<"choose" | "create" | "join">("choose");
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const username = useUserStore((s) => s.username);
  const defaultName = username ? `${username}'s Cove` : "My Cove";
  const [name, setName] = useState(defaultName);

  // Update name when user data arrives
  useEffect(() => {
    if (username && name === "My Cove") {
      setName(`${username}'s Cove`);
    }
  }, [username]);

  const handleCreate = useCallback(async () => {
    setLoading(true);
    setError("");
    const islandName = name.trim() || defaultName;
    try {
      const guild = await api.createGuild(islandName);
      // Add guild to store immediately, then reload cleanly
      useGuildStore.getState().addGuild({ id: guild.id, name: guild.name, icon: guild.icon, owner_id: guild.owner_id });
      window.location.href = "/";
    } catch {
      setError("Failed to create Cove");
      setLoading(false);
    }
  }, [name, defaultName]);

  const handleJoin = useCallback(async () => {
    if (!joinCode.trim()) return;
    setLoading(true);
    setError("");
    try {
      await api.joinGuild(joinCode.trim());
      window.location.reload();
    } catch {
      setError("Invalid invite or Cove not found");
      setLoading(false);
    }
  }, [joinCode]);

  if (mode === "choose") {
    return (
      <div className="ob-page">
        <div className="ob-login-card">
          <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>🏝️</div>
          <h2 className="ob-code-title">Welcome to Cove</h2>
          <p className="ob-code-desc">What would you like to do?</p>
          <button
            className="ob-google-btn"
            style={{ marginBottom: "0.75rem", background: "#5865f2", color: "white" }}
            onClick={() => setMode("create")}
          >
            Create my Cove
          </button>
          <button
            className="ob-google-btn"
            style={{ background: "#1a1d23", color: "#e8e8e8", border: "1px solid #333" }}
            onClick={() => setMode("join")}
          >
            Join a Cove
          </button>
        </div>
      </div>
    );
  }

  if (mode === "join") {
    return (
      <div className="ob-page">
        <div className="ob-login-card">
          <h2 className="ob-code-title">Join a Cove</h2>
          <p className="ob-code-desc">Enter the invite link or code you received.</p>
          <div className="ob-code-row">
            <input
              className="ob-code-input"
              placeholder="Invite link or code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            />
            <button className="ob-code-btn" onClick={handleJoin} disabled={loading}>→</button>
          </div>
          {error && <p className="ob-error">{error}</p>}
          <button className="ob-back-btn" onClick={() => { setMode("choose"); setError(""); }}>← Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ob-page">
      <div className="ob-login-card">
        <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>🏝️</div>
        <h2 className="ob-code-title">Create your Cove</h2>
        <p className="ob-code-desc">A private space for you and your AI agent — your own little cove to chat, build, and live together.</p>
        <p style={{ color: "#ccc", fontSize: "0.9rem", fontWeight: 500, marginBottom: "0.5rem", textAlign: "left" }}>Name your Cove</p>
        <div className="ob-code-row">
          <input
            className="ob-code-input"
            placeholder={defaultName}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
        </div>
        {error && <p className="ob-error">{error}</p>}
        <button
          className="ob-google-btn"
          style={{ marginTop: "1.5rem", background: "#5865f2", color: "white" }}
          onClick={handleCreate}
          disabled={loading}
        >
          Create Cove →
        </button>
        <button className="ob-back-btn" onClick={() => { setMode("choose"); setError(""); }}>← Back</button>
      </div>
    </div>
  );
}

function LoginPage() {
  return (
    <div className="ob-page">
      <div className="ob-login-card">
        <h1 className="ob-logo">🏝️ Cove</h1>
        <p className="ob-tagline">A private space for you and your AI agent.<br/>Chat, build, and live together.</p>
        <button
          className="ob-google-btn"
          onClick={() => {
            sessionStorage.setItem("cove_return_path", window.location.pathname);
            window.location.href = `${API_BASE}/api/auth/google`;
          }}
        >
          <span className="ob-google-icon">G</span>
          Sign in with Google
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const themeConfig = useAntdThemeConfig();
  useVisualViewport();
  const { needsSetup, setUser } = useUserStore();
  const connect = useWebSocketStore((s) => s.connect);
  const [authLoading, setAuthLoading] = useState(true);
  const [isPending, setIsPending] = useState(false);
  const [isNewUser, setIsNewUser] = useState(false);
  const guilds = useGuildStore((s) => s.guilds);
  const gatewayReady = useGuildStore((s) => s.gatewayReady);

  useEffect(() => {
    localStorage.removeItem("cove-token");
    localStorage.removeItem("cove-user");

    const params = new URLSearchParams(window.location.search);
    if (params.has("token") || params.has("pending")) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    api.fetchPendingStatus()
      .then((status) => {
        if (status.pending) {
          setIsPending(true);
          setAuthLoading(false);
          return;
        }
        return api.fetchMe()
          .then((user) => {
            setUser(user);
          })
          .catch(() => {
            useUserStore.setState({ needsSetup: true });
          });
      })
      .catch(() => {
        useUserStore.setState({ needsSetup: true });
      })
      .finally(() => setAuthLoading(false));
  }, [setUser]);

  // After auth, restore saved path from OAuth flow
  useEffect(() => {
    if (authLoading || needsSetup || isPending) return;
    const returnPath = sessionStorage.getItem("cove_return_path");
    if (returnPath && returnPath !== "/") {
      sessionStorage.removeItem("cove_return_path");
      router.navigate(returnPath, { replace: true });
    }
  }, [authLoading, needsSetup, isPending]);

  // Detect new user (no guilds after gateway READY)
  useEffect(() => {
    if (gatewayReady && Object.keys(guilds).length === 0) {
      setIsNewUser(true);
    }
  }, [gatewayReady, guilds]);

  useEffect(() => {
    if (needsSetup || authLoading) return;
    setupGatewaySubscriptions();
    connect();

    // Fallback: if READY isn't received within 8s, load channels via REST
    const fallbackTimer = setTimeout(() => {
      const guildStore = useGuildStore.getState();
      const guildIds = Object.keys(guildStore.guilds);
      if (guildIds.length === 0) return;
      const guildId = guildIds[0];
      const currentChannels = useChannelStore.getState().getChannels(guildId);
      if (currentChannels.length === 0) {
        api.fetchChannels(guildId)
          .then((chs) => {
            if (useChannelStore.getState().getChannels(guildId).length === 0) {
              useChannelStore.getState().setChannels(guildId, chs);
              const { channelId } = getActiveIdsFromRouter();
              if (!channelId && chs.length > 0) {
                router.navigate(routes.channel(guildId, chs[0].id), { replace: true });
              }
            }
          })
          .catch(() => {});
      }
    }, 8000);

    return () => {
      clearTimeout(fallbackTimer);
      teardownGatewaySubscriptions();
    };
  }, [needsSetup, authLoading, connect]);

  if (authLoading) {
    return (
      <ConfigProvider theme={themeConfig}>
        <div className="ob-page">
          <div style={{ fontSize: "2rem" }}>🏝️</div>
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

  // Allow /onboarding-preview without auth
  if (window.location.pathname === "/onboarding-preview") {
    return (
      <ConfigProvider theme={themeConfig}>
        <RouterProvider router={router} />
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

  if (isNewUser && Object.keys(guilds).length === 0) {
    return (
      <ConfigProvider theme={themeConfig}>
        <div style={styles.fullHeight}>
          <CreateCovePage />
        </div>
      </ConfigProvider>
    );
  }

  if (!gatewayReady) {
    return (
      <ConfigProvider theme={themeConfig}>
        <div className="ob-page">
          <div style={{ fontSize: "2rem" }}>🏝️</div>
        </div>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider theme={themeConfig}>
      <RouterProvider router={router} />
    </ConfigProvider>
  );
}
