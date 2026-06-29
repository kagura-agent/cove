import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSceneStore } from "../stores/useSceneStore";
import { useChannelStore } from "../stores/useChannelStore";
import { useGuildStore } from "../stores/useGuildStore";
import { useTypingStore } from "../stores/useTypingStore";
import { useUserPermissions } from "../lib/useUserPermissions";
import { PermissionBits } from "@cove/shared";
import { useActiveIds } from "../hooks/useActiveIds";
import { routes } from "../lib/routes";
import * as api from "../lib/api";
import { Button, Modal, Input, Select, message, Dropdown } from "antd";
import { PlusOutlined, MoreOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import type { CSSProperties } from "react";
import type { Scene } from "../lib/api";

// ── Activity tracking (client-side, from gateway events) ──────

// Track recent message activity per channel (timestamp of last message)
const recentActivity = new Map<string, number>();
const ACTIVITY_DURATION = 5000; // 5s glow

// Track connection flashes: key = "sceneId:chA:chB" → expiry timestamp
const connectionFlashes = new Map<string, number>();

// Subscribe to MESSAGE_CREATE for activity tracking
let activityListenerSetup = false;

function setupActivityListener() {
  if (activityListenerSetup) return;
  activityListenerSetup = true;

  // We'll use a simple polling approach for now — the gateway-subscriptions
  // already handle MESSAGE_CREATE. We just need to track timestamps.
  // This is done via a global event on window.
  window.addEventListener("cove-message-create", ((e: CustomEvent) => {
    const { channelId, content } = e.detail;
    recentActivity.set(channelId, Date.now());

    // Check for channel mentions <#channelId> for connection flash
    const mentionRegex = /<#(\d+)>/g;
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
      const mentionedChannelId = match[1];
      if (mentionedChannelId !== channelId) {
        // Find scenes that contain both channels
        const scenes = useSceneStore.getState();
        for (const guildScenes of Object.values(scenes.scenesByGuildId)) {
          for (const scene of guildScenes) {
            const hasSource = scene.channels.some((c) => c.id === channelId);
            const hasTarget = scene.channels.some((c) => c.id === mentionedChannelId);
            if (hasSource && hasTarget) {
              const key = `${scene.id}:${[channelId, mentionedChannelId].sort().join(":")}`;
              connectionFlashes.set(key, Date.now() + ACTIVITY_DURATION);
            }
          }
        }
      }
    }
  }) as EventListener);
}

function isChannelActive(channelId: string): boolean {
  const ts = recentActivity.get(channelId);
  return ts ? Date.now() - ts < ACTIVITY_DURATION : false;
}

function hasConnectionFlash(sceneId: string, chA: string, chB: string): boolean {
  const key = `${sceneId}:${[chA, chB].sort().join(":")}`;
  const expiry = connectionFlashes.get(key);
  return expiry ? Date.now() < expiry : false;
}

// ── Styles ────────────────────────────────────────────────────

const styles = {
  container: {
    flex: 1,
    padding: 24,
    overflowY: "auto",
    background: "var(--bg-primary)",
  } as CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  } as CSSProperties,
  title: {
    fontSize: "var(--font-size-xxl)",
    fontWeight: 700,
    color: "var(--header-primary)",
    margin: 0,
  } as CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
    gap: 16,
  } as CSSProperties,
  card: {
    background: "var(--bg-secondary)",
    borderRadius: 8,
    padding: 16,
    border: "1px solid var(--border-subtle)",
    transition: "border-color 0.2s",
  } as CSSProperties,
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  } as CSSProperties,
  cardTitle: {
    fontSize: "var(--font-size-lg)",
    fontWeight: 600,
    color: "var(--header-primary)",
  } as CSSProperties,
  nodesGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  } as CSSProperties,
  node: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 10px",
    borderRadius: 6,
    background: "var(--bg-tertiary)",
    cursor: "pointer",
    fontSize: "var(--font-size-sm)",
    color: "var(--text-normal)",
    transition: "background 0.2s, box-shadow 0.3s",
    border: "1px solid transparent",
  } as CSSProperties,
  nodeActive: {
    boxShadow: "0 0 8px var(--accent-brand)",
    borderColor: "var(--accent-brand)",
  } as CSSProperties,
  nodeTyping: {
    borderColor: "var(--status-positive, #3ba55d)",
  } as CSSProperties,
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 64,
    color: "var(--text-muted)",
    textAlign: "center",
    gap: 16,
  } as CSSProperties,
};

// ── Channel Node ──────────────────────────────────────────────

function ChannelNode({ channel, guildId, sceneId }: { channel: { id: string; name: string }; guildId: string; sceneId: string }) {
  const navigate = useNavigate();
  const typingUsers = useTypingStore((s) => s.typingUsers[channel.id] ?? []);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const check = () => setActive(isChannelActive(channel.id));
    check();
    const timer = setInterval(check, 1000);
    return () => clearInterval(timer);
  }, [channel.id]);

  const isTyping = typingUsers.length > 0;

  return (
    <div
      style={{
        ...styles.node,
        ...(active ? styles.nodeActive : {}),
        ...(isTyping ? styles.nodeTyping : {}),
      }}
      onClick={() => navigate(routes.channel(guildId, channel.id))}
      title={`#${channel.name}${isTyping ? " (typing...)" : ""}`}
    >
      <span style={{ opacity: 0.5 }}>#</span>
      <span>{channel.name}</span>
      {isTyping && <span style={{ fontSize: 10, opacity: 0.6 }}>✏️</span>}
    </div>
  );
}

// ── Scene Card ────────────────────────────────────────────────

function SceneCard({ scene, guildId, canManage, onEdit, onDelete }: {
  scene: Scene; guildId: string; canManage: boolean;
  onEdit: (scene: Scene) => void; onDelete: (scene: Scene) => void;
}) {
  const menuItems = canManage ? [
    { key: "edit", label: "Edit Scene", icon: <EditOutlined /> },
    { key: "delete", label: "Delete Scene", icon: <DeleteOutlined />, danger: true },
  ] : [];

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <span style={styles.cardTitle}>{scene.name}</span>
        {canManage && (
          <Dropdown menu={{
            items: menuItems,
            onClick: ({ key }) => {
              if (key === "edit") onEdit(scene);
              if (key === "delete") onDelete(scene);
            },
          }} trigger={["click"]}>
            <Button type="text" size="small" icon={<MoreOutlined />} />
          </Dropdown>
        )}
      </div>
      <div style={styles.nodesGrid}>
        {scene.channels.length === 0 ? (
          <span style={{ color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>No visible channels</span>
        ) : (
          scene.channels.map((ch) => (
            <ChannelNode key={ch.id} channel={ch} guildId={guildId} sceneId={scene.id} />
          ))
        )}
      </div>
    </div>
  );
}

// ── Create/Edit Scene Dialog ──────────────────────────────────

function SceneDialog({ open, onClose, guildId, editing }: {
  open: boolean; onClose: () => void; guildId: string; editing?: Scene | null;
}) {
  const [name, setName] = useState("");
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const channels = useChannelStore((s) => s.getChannels(guildId));
  const textChannels = channels.filter((ch) => ch.type === 0);

  useEffect(() => {
    if (editing) {
      setName(editing.name);
      setSelectedChannels(editing.channels.map((c) => c.id));
    } else {
      setName("");
      setSelectedChannels([]);
    }
  }, [editing, open]);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed || selectedChannels.length === 0) return;

    setLoading(true);
    try {
      if (editing) {
        await api.updateScene(guildId, editing.id, { name: trimmed, channel_ids: selectedChannels });
      } else {
        await api.createScene(guildId, trimmed, selectedChannels);
      }
      // Gateway event will trigger re-fetch
      onClose();
    } catch (err: any) {
      message.error(err?.message ?? "Failed to save scene");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={editing ? "Edit Scene" : "Create Scene"}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 8 }}>
        <div>
          <label style={{ display: "block", marginBottom: 4, fontWeight: 500, color: "var(--text-normal)" }}>
            Scene Name
          </label>
          <Input
            placeholder="e.g. Development Pipeline"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            autoFocus
          />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: 4, fontWeight: 500, color: "var(--text-normal)" }}>
            Channels
          </label>
          <Select
            mode="multiple"
            placeholder="Select channels..."
            value={selectedChannels}
            onChange={setSelectedChannels}
            style={{ width: "100%" }}
            options={textChannels.map((ch) => ({ label: `#${ch.name}`, value: ch.id }))}
            maxCount={15}
          />
        </div>
        <Button
          type="primary"
          onClick={handleSubmit}
          loading={loading}
          disabled={!name.trim() || selectedChannels.length === 0}
          block
        >
          {editing ? "Save Changes" : "Create"}
        </Button>
      </div>
    </Modal>
  );
}

// ── Server Overview Page ──────────────────────────────────────

export function ServerOverview() {
  const { guildId } = useActiveIds();
  const guild = useGuildStore((s) => guildId ? s.guilds[guildId] : null);
  const scenes = useSceneStore((s) => s.getScenes(guildId));
  const { userPermissions, isOwner } = useUserPermissions(guildId ?? "");
  const canManage = isOwner || !!(userPermissions & PermissionBits.MANAGE_GUILD);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingScene, setEditingScene] = useState<Scene | null>(null);

  useEffect(() => {
    setupActivityListener();
  }, []);

  // Fetch scenes on mount
  useEffect(() => {
    if (!guildId) return;
    api.fetchScenes(guildId)
      .then((s) => useSceneStore.getState().setScenes(guildId, s))
      .catch(() => {});
  }, [guildId]);

  const handleEdit = useCallback((scene: Scene) => {
    setEditingScene(scene);
    setDialogOpen(true);
  }, []);

  const handleDelete = useCallback(async (scene: Scene) => {
    if (!guildId) return;
    try {
      await api.deleteScene(guildId, scene.id);
      message.success("Scene deleted");
    } catch {
      message.error("Failed to delete scene");
    }
  }, [guildId]);

  const handleCloseDialog = useCallback(() => {
    setDialogOpen(false);
    setEditingScene(null);
  }, []);

  if (!guildId || !guild) return null;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>{guild.name}</h1>
        {canManage && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => { setEditingScene(null); setDialogOpen(true); }}
          >
            Create Scene
          </Button>
        )}
      </div>

      {scenes.length === 0 ? (
        <div style={styles.emptyState as any}>
          <div style={{ fontSize: 48 }}>🏝️</div>
          <div style={{ fontSize: "var(--font-size-lg)", fontWeight: 600 }}>No scenes yet</div>
          <div>Scenes show live channel collaboration at a glance.</div>
          {canManage && (
            <Button type="primary" onClick={() => setDialogOpen(true)}>
              Create your first scene
            </Button>
          )}
        </div>
      ) : (
        <div style={styles.grid}>
          {scenes.map((scene) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              guildId={guildId}
              canManage={canManage}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <SceneDialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        guildId={guildId}
        editing={editingScene}
      />
    </div>
  );
}
