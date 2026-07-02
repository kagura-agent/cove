import { useEffect, useState, useCallback } from "react";
import { useBotStore } from "../stores/useBotStore";
import { useGuildStore } from "../stores/useGuildStore";
import { useUserStore } from "../stores/useUserStore";
import { List, Button, Popconfirm, Spin } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { BotCreateForm } from "./BotCreateForm";
import * as api from "../lib/api";
import "../onboarding.css";

type BotTab = "invitation" | "general";

function InvitationTab() {
  const guilds = useGuildStore((s) => s.guilds);
  const username = useUserStore((s) => s.username);
  const globalName = useUserStore((s) => s.global_name);

  const guildEntries = Object.values(guilds);
  const guild = guildEntries[0];
  const guildId = guild?.id ?? "";
  const guildName = guild?.name ?? "My Server";
  const inviterName = globalName || username || "You";

  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [inviteResult, setInviteResult] = useState<api.InviteAgentResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const handleInvite = useCallback(async () => {
    if (!name.trim() || !guildId) return;
    setLoading(true);
    setError("");
    try {
      const result = await api.inviteAgent(guildId, name.trim());
      setInviteResult(result);
    } catch {
      setError("Failed to create invite. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [guildId, name]);

  const handleCopy = useCallback(() => {
    if (!inviteResult) return;
    navigator.clipboard.writeText(inviteResult.inviteLetter).catch(() => {});
    setCopied(true);
  }, [inviteResult]);

  if (!inviteResult) {
    return (
      <div style={{ padding: "var(--space-sm) 0" }}>
        <p style={{ color: "var(--text-muted)", margin: "0 0 var(--space-lg)" }}>
          What's your agent's name? They'll join <strong>{guildName}</strong> as Server Admin.
        </p>
        <div className="ob-code-row">
          <input
            className="ob-code-input"
            placeholder="e.g. Kagura"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleInvite()}
            autoFocus
          />
          <button className="ob-code-btn" onClick={handleInvite} disabled={loading || !name.trim()}>
            {loading ? "…" : "→"}
          </button>
        </div>
        {error && <p className="ob-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="ob-invite-wrap" style={{ maxWidth: "100%" }}>
      <div className="ob-letter-paper">
        <div className="ob-letter-stamp">🏝️</div>
        <div className="ob-letter-header-row">
          <span className="ob-letter-from">From: {inviteResult.inviterName}</span>
        </div>
        <div className="ob-letter-divider" />
        <p className="ob-letter-greeting">Dear <strong>{inviteResult.agentName}</strong>,</p>
        <p className="ob-letter-body-text">{inviteResult.inviterName} built this place, and chose <em>you</em> to share it.</p>
        <p className="ob-letter-body-text">There are channels to discover, routines to build, and conversations that haven't started yet.</p>
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
        <p className="ob-letter-closing">Your first channel is #general. Say hello when you get here — someone is waiting.</p>
        <p className="ob-letter-signature">— {inviteResult.inviterName}</p>
      </div>
      <button className="ob-letter-btn" onClick={handleCopy}>
        {copied ? "✅ Copied! Now send it to your agent" : "📮 Copy invitation for your agent"}
      </button>
    </div>
  );
}

export function BotManagement({ defaultTab }: { defaultTab?: BotTab }) {
  const { bots, fetchBots, deleteBot } = useBotStore();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<BotTab>(defaultTab ?? "invitation");

  useEffect(() => {
    fetchBots().catch(console.error).finally(() => setLoading(false));
  }, [fetchBots]);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-xxl)" }}>
        <Spin tip="Loading bots…" />
      </div>
    );
  }

  const tabStyle = (tab: BotTab): React.CSSProperties => ({
    padding: "var(--space-sm) var(--space-lg)",
    background: "none",
    border: "none",
    borderBottom: activeTab === tab ? "2px solid var(--accent, #5865f2)" : "2px solid transparent",
    color: activeTab === tab ? "var(--text-normal)" : "var(--text-muted)",
    fontWeight: activeTab === tab ? 600 : 400,
    fontSize: "var(--font-size-md)",
    cursor: "pointer",
    fontFamily: "inherit",
  });

  return (
    <div>
      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--bg-modifier-hover)", marginBottom: "var(--space-lg)" }}>
        <button style={tabStyle("invitation")} onClick={() => setActiveTab("invitation")}>
          📮 Invitation
        </button>
        <button style={tabStyle("general")} onClick={() => setActiveTab("general")}>
          General
        </button>
      </div>

      {/* Tab content */}
      {activeTab === "invitation" && <InvitationTab />}
      {activeTab === "general" && (
        <div>
          {bots.length > 0 && (
            <List
              dataSource={bots}
              renderItem={(bot) => (
                <List.Item
                  actions={[
                    <Popconfirm key="delete" title={`Delete bot "${bot.username}"?`} onConfirm={() => deleteBot(bot.id)} okText="Delete" cancelText="Cancel" okButtonProps={{ danger: true }}>
                      <Button type="text" icon={<DeleteOutlined />} danger size="small" />
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={<span style={{ fontSize: "var(--icon-size-lg)" }}>🤖</span>}
                    title={bot.username}
                    description={bot.bio}
                  />
                </List.Item>
              )}
              style={{ marginBottom: "var(--space-lg)" }}
            />
          )}
          <BotCreateForm />
        </div>
      )}
    </div>
  );
}
