import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useSceneStore } from "../stores/useSceneStore";
import { useTypingStore } from "../stores/useTypingStore";
import type { CSSProperties } from "react";

const COLLAPSE_KEY = "cove_minimap_collapsed";
const MAX_VISIBLE = 3;

const styles = {
  container: {
    position: "absolute",
    top: 8,
    right: 8,
    zIndex: 10,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    maxWidth: 200,
  } as CSSProperties,
  toggle: {
    alignSelf: "flex-end",
    background: "var(--bg-secondary)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    padding: "2px 6px",
    fontSize: 11,
    color: "var(--text-muted)",
    cursor: "pointer",
    opacity: 0.7,
    transition: "opacity 0.2s",
  } as CSSProperties,
  card: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    padding: "6px 8px",
    cursor: "pointer",
    transition: "border-color 0.2s",
  } as CSSProperties,
  cardTitle: {
    fontSize: 10,
    fontWeight: 600,
    color: "var(--text-muted)",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  } as CSSProperties,
  nodes: {
    display: "flex",
    flexWrap: "wrap",
    gap: 3,
  } as CSSProperties,
  node: {
    fontSize: 10,
    padding: "1px 5px",
    borderRadius: 3,
    background: "var(--bg-tertiary)",
    color: "var(--text-normal)",
    border: "1px solid transparent",
    transition: "border-color 0.3s, box-shadow 0.3s",
  } as CSSProperties,
  nodeCurrent: {
    borderColor: "var(--accent-brand)",
    fontWeight: 600,
  } as CSSProperties,
  nodeTyping: {
    borderColor: "var(--status-positive, #3ba55d)",
  } as CSSProperties,
  overflow: {
    fontSize: 10,
    color: "var(--text-muted)",
    textAlign: "center",
    padding: 2,
  } as CSSProperties,
};

function MiniNode({ channelId, name, isCurrent }: { channelId: string; name: string; isCurrent: boolean }) {
  const typingUsers = useTypingStore((s) => s.typingUsers[channelId] ?? []);
  const isTyping = typingUsers.length > 0;

  return (
    <span style={{
      ...styles.node,
      ...(isCurrent ? styles.nodeCurrent : {}),
      ...(isTyping && !isCurrent ? styles.nodeTyping : {}),
    }}>
      #{name}
    </span>
  );
}

export function SceneMiniMap({ channelId, guildId }: { channelId: string; guildId: string }) {
  const allScenes = useSceneStore((s) => s.scenesByGuildId);
  const scenes = useMemo(
    () => Object.values(allScenes).flat().filter((sc) => sc.channels.some((ch) => ch.id === channelId)),
    [allScenes, channelId]
  );
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "true"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, String(collapsed)); } catch {}
  }, [collapsed]);

  if (scenes.length === 0) return null;

  const visible = scenes.slice(0, MAX_VISIBLE);
  const overflow = scenes.length - MAX_VISIBLE;

  return (
    <div style={styles.container}>
      <div
        style={styles.toggle}
        onClick={() => setCollapsed(!collapsed)}
        onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = "1"; }}
        onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = "0.7"; }}
      >
        {collapsed ? `▶ ${scenes.length} scene${scenes.length > 1 ? "s" : ""}` : "▼ Scenes"}
      </div>

      {!collapsed && (
        <>
          {visible.map((scene) => (
            <div
              key={scene.id}
              style={styles.card}
              onClick={() => navigate(`/channels/${guildId}`)}
              title={`${scene.name} — click for overview`}
            >
              <div style={styles.cardTitle}>{scene.name}</div>
              <div style={styles.nodes as any}>
                {scene.channels.map((ch) => (
                  <MiniNode key={ch.id} channelId={ch.id} name={ch.name} isCurrent={ch.id === channelId} />
                ))}
              </div>
            </div>
          ))}
          {overflow > 0 && (
            <div style={styles.overflow as any}>+{overflow} more</div>
          )}
        </>
      )}
    </div>
  );
}
