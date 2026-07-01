import { useEffect, useState, useCallback, useRef } from "react";
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
import { dispatcher } from "./lib/gateway-dispatcher";
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

function CreateCovePage({ onGuildCreated }: { onGuildCreated?: (guildId: string) => void }) {
  const [mode, setMode] = useState<"choose" | "create" | "join">("choose");
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const username = useUserStore((s) => s.username);
  const defaultName = username ? `${username}'s Server` : "My Server";
  const [name, setName] = useState(defaultName);

  // Update name when user data arrives
  useEffect(() => {
    if (username && name === "My Server") {
      setName(`${username}'s Server`);
    }
  }, [username]);

  const handleCreate = useCallback(async () => {
    setLoading(true);
    setError("");
    const islandName = name.trim() || defaultName;
    try {
      const guild = await api.createGuild(islandName);
      // Add guild to store immediately
      useGuildStore.getState().addGuild({ id: guild.id, name: guild.name, icon: guild.icon, owner_id: guild.owner_id, features: [] });
      if (onGuildCreated) {
        onGuildCreated(guild.id);
      } else {
        window.location.href = "/";
      }
    } catch {
      setError("Failed to create server");
      setLoading(false);
    }
  }, [name, defaultName, onGuildCreated]);

  const handleJoin = useCallback(async () => {
    if (!joinCode.trim()) return;
    setLoading(true);
    setError("");
    try {
      await api.joinGuild(joinCode.trim());
      window.location.reload();
    } catch {
      setError("Invalid invite or server not found");
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
            Create a server
          </button>
          <button
            className="ob-google-btn"
            style={{ background: "#1a1d23", color: "#e8e8e8", border: "1px solid #333" }}
            onClick={() => setMode("join")}
          >
            Join a server
          </button>
        </div>
      </div>
    );
  }

  if (mode === "join") {
    return (
      <div className="ob-page">
        <div className="ob-login-card">
          <h2 className="ob-code-title">Join a server</h2>
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
        <h2 className="ob-code-title">Create your server</h2>
        <p className="ob-code-desc">A private space for you and your AI agent — your own space to chat, build, and live together.</p>
        <p style={{ color: "#ccc", fontSize: "0.9rem", fontWeight: 500, marginBottom: "0.5rem", textAlign: "left" }}>Name your server</p>
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
          Create server →
        </button>
        <button className="ob-back-btn" onClick={() => { setMode("choose"); setError(""); }}>← Back</button>
      </div>
    </div>
  );
}

function InviteAgentPage({
  guildId,
  guildName,
  onDone,
  onSkip,
}: {
  guildId: string;
  guildName: string;
  onDone: (agentName: string, inviteLetter: string) => void;
  onSkip: () => void;
}) {
  const [agentName, setAgentName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [inviteLetter, setInviteLetter] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleInvite = useCallback(async () => {
    const name = agentName.trim();
    if (!name) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.inviteAgent(guildId, name);
      setInviteLetter(res.inviteLetter);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("409") ? `An agent named '${name}' already exists. Try a different name.` : "Failed to invite agent. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [agentName, guildId]);

  const handleCopy = useCallback(() => {
    if (!inviteLetter) return;
    navigator.clipboard?.writeText(inviteLetter).catch(() => {});
    setCopied(true);
    setTimeout(() => onDone(agentName.trim(), inviteLetter), 600);
  }, [inviteLetter, agentName, onDone]);

  if (inviteLetter) {
    return (
      <div className="ob-page">
        <div className="ob-invite-wrap">
          <div className="ob-letter-paper">
            <div className="ob-letter-stamp">🏝️</div>
            <div className="ob-letter-header-row">
              <span className="ob-letter-from">From: {guildName}</span>
            </div>
            <div className="ob-letter-divider" />
            <p className="ob-letter-greeting">Dear <strong>{agentName.trim()}</strong>,</p>
            <p className="ob-letter-body-text">You've been invited to join <strong>{guildName}</strong> as <strong>Server Admin</strong>.</p>
            <p className="ob-letter-body-text">A private cove awaits — with channels to explore, routines to build, and a human who chose you.</p>
            <div className="ob-letter-divider" />
            <div className="ob-letter-details">
              <div className="ob-letter-detail-row">
                <span className="ob-letter-label">🏝️ Server</span>
                <span className="ob-letter-value">{guildName}</span>
              </div>
              <div className="ob-letter-detail-row">
                <span className="ob-letter-label">👑 Role</span>
                <span className="ob-letter-value">Server Admin</span>
              </div>
            </div>
            <div className="ob-letter-divider" />
            <details style={{ marginTop: "0.5rem" }}>
              <summary style={{ fontSize: "0.8rem", color: "#888", cursor: "pointer" }}>View install commands</summary>
              <pre className="ob-letter-pre" style={{ marginTop: "0.5rem" }}>{inviteLetter}</pre>
            </details>
            <p className="ob-letter-closing">We look forward to your arrival.</p>
            <p className="ob-letter-signature">— {guildName}</p>
          </div>
          <button className="ob-letter-btn" onClick={handleCopy}>
            {copied ? "✅ Copied!" : "📮 Copy invitation"}
          </button>
          <button className="ob-back-btn" onClick={onSkip} style={{ display: "block", margin: "0.5rem auto 0" }}>Skip → Go to channels</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ob-page">
      <div className="ob-login-card">
        <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>🤖</div>
        <h2 className="ob-code-title">Invite your agent</h2>
        <p className="ob-code-desc">What’s your agent’s name? They’ll join <strong style={{ color: "#e8e8e8" }}>{guildName}</strong> as Server Admin.</p>
        <div className="ob-code-row">
          <input
            className="ob-code-input"
            placeholder="e.g. Kagura"
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleInvite()}
            autoFocus
          />
          <button className="ob-code-btn" onClick={handleInvite} disabled={loading || !agentName.trim()}>
            {loading ? "…" : "→"}
          </button>
        </div>
        {error && <p className="ob-error">{error}</p>}
        <button className="ob-back-btn" onClick={onSkip}>Skip → Go to channels</button>
      </div>
    </div>
  );
}

function WaitingPage({
  agentName,
  guildId,
  onArrived,
  onSkip,
}: {
  agentName: string;
  guildId: string;
  onArrived: () => void;
  onSkip: () => void;
}) {
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    const handler = (data: { guild_id: string; user: { id: string }; nick: string | null; roles: string[]; joined_at: string }) => {
      if (data.guild_id !== guildId) return;
      setArrived(true);
      setTimeout(onArrived, 2000);
    };
    dispatcher.on("GUILD_MEMBER_ADD", handler);
    return () => dispatcher.off("GUILD_MEMBER_ADD", handler);
  }, [guildId, onArrived]);

  return (
    <div className="ob-page">
      <div className="ob-waiting-card">
        {arrived ? (
          <>
            <div style={{ fontSize: "4rem" }}>🎉</div>
            <h2 className="ob-waiting-title">{agentName} has arrived!</h2>
            <p style={{ color: "#888", fontSize: "0.9rem", margin: 0 }}>Heading to your server…</p>
          </>
        ) : (
          <>
            <div className="ob-waiting-spinner">🔄</div>
            <h2 className="ob-waiting-title">Waiting for {agentName} to arrive…</h2>
            <p style={{ color: "#888", fontSize: "0.9rem", margin: 0 }}>Paste the invitation in your agent’s terminal to connect.</p>
            <button className="ob-back-btn" onClick={onSkip}>Skip → Go to channels</button>
          </>
        )}
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
  const [inviteGuildId, setInviteGuildId] = useState<string | null>(null);
  const [invitePhase, setInvitePhase] = useState<"name" | "letter" | "waiting" | null>(null);
  const [inviteAgentName, setInviteAgentName] = useState("");
  const inviteGuildName = useRef<string>("");
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

  if (isNewUser && Object.keys(guilds).length === 0 && !invitePhase) {
    return (
      <ConfigProvider theme={themeConfig}>
        <div style={styles.fullHeight}>
          <CreateCovePage
            onGuildCreated={(gid) => {
              // Look up guild name from store
              const g = useGuildStore.getState().guilds[gid];
              inviteGuildName.current = g?.name ?? "My Server";
              setInviteGuildId(gid);
              setInvitePhase("name");
            }}
          />
        </div>
      </ConfigProvider>
    );
  }

  if (invitePhase === "name" || invitePhase === "letter") {
    return (
      <ConfigProvider theme={themeConfig}>
        <div style={styles.fullHeight}>
          <InviteAgentPage
            guildId={inviteGuildId!}
            guildName={inviteGuildName.current}
            onDone={(name) => {
              setInviteAgentName(name);
              setInvitePhase("waiting");
            }}
            onSkip={() => {
              setInvitePhase(null);
              setInviteGuildId(null);
              window.location.href = "/";
            }}
          />
        </div>
      </ConfigProvider>
    );
  }

  if (invitePhase === "waiting") {
    return (
      <ConfigProvider theme={themeConfig}>
        <div style={styles.fullHeight}>
          <WaitingPage
            agentName={inviteAgentName}
            guildId={inviteGuildId!}
            onArrived={() => {
              setInvitePhase(null);
              setInviteGuildId(null);
              window.location.href = "/";
            }}
            onSkip={() => {
              setInvitePhase(null);
              setInviteGuildId(null);
              window.location.href = "/";
            }}
          />
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
