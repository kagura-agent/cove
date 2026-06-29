import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGuildStore } from "../stores/useGuildStore";
import { useChannelStore } from "../stores/useChannelStore";
import { useReadStateStore } from "../stores/useReadStateStore";
import { useActiveIds } from "../hooks/useActiveIds";
import { routes } from "../lib/routes";
import { Tooltip } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { CreateServerDialog } from "./CreateServerDialog";
import type { CSSProperties } from "react";

const GUILD_SIDEBAR_WIDTH = 56;

const styles = {
  root: {
    width: GUILD_SIDEBAR_WIDTH,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    background: "var(--bg-tertiary)",
    paddingTop: 8,
    gap: 6,
    overflowY: "auto",
    overflowX: "hidden",
    minHeight: 0,
  } as CSSProperties,
  guildIcon: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-normal)",
    background: "var(--bg-primary)",
    transition: "border-radius 0.2s, background 0.2s",
    position: "relative",
    overflow: "hidden",
    userSelect: "none",
  } as CSSProperties,
  guildIconActive: {
    borderRadius: 10,
    background: "var(--accent-brand)",
    color: "#fff",
  } as CSSProperties,
  guildIconHover: {
    borderRadius: 10,
    background: "var(--accent-brand)",
    color: "#fff",
  } as CSSProperties,
  pill: {
    position: "absolute",
    left: 0,
    top: "50%",
    transform: "translateY(-50%)",
    width: 3,
    borderRadius: "0 3px 3px 0",
    background: "var(--header-primary)",
    transition: "height 0.2s",
  } as CSSProperties,
  pillActive: { height: 30 } as CSSProperties,
  pillHover: { height: 16 } as CSSProperties,
  pillUnread: { height: 6 } as CSSProperties,
  separator: {
    width: 24,
    height: 2,
    borderRadius: 1,
    background: "var(--border-subtle)",
    margin: "0 0 2px",
  } as CSSProperties,
  addButton: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    fontSize: 16,
    color: "var(--status-positive, #3ba55d)",
    background: "var(--bg-primary)",
    transition: "border-radius 0.2s, background 0.2s, color 0.2s",
  } as CSSProperties,
  addButtonHover: {
    borderRadius: 10,
    background: "var(--status-positive, #3ba55d)",
    color: "#fff",
  } as CSSProperties,
  wrapper: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: GUILD_SIDEBAR_WIDTH,
    height: 36,
    marginBottom: 0,
  } as CSSProperties,
  unreadDot: {
    position: "absolute",
    left: 0,
    top: "50%",
    transform: "translateY(-50%)",
    width: 4,
    height: 8,
    borderRadius: "0 4px 4px 0",
    background: "var(--header-primary)",
  } as CSSProperties,
};

function getAbbreviation(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const LAST_CHANNEL_KEY = "cove_last_channel_";

function getLastChannelForGuild(guildId: string): string | null {
  try {
    return localStorage.getItem(LAST_CHANNEL_KEY + guildId);
  } catch {
    return null;
  }
}

export function saveLastChannel(guildId: string, channelId: string): void {
  try {
    localStorage.setItem(LAST_CHANNEL_KEY + guildId, channelId);
  } catch {
    // ignore
  }
}

export function GuildSidebar() {
  const guilds = useGuildStore((s) => s.guilds);
  const { guildId: activeGuildId } = useActiveIds();
  const navigate = useNavigate();
  const getChannels = useChannelStore((s) => s.getChannels);
  const unreadChannels = useReadStateStore((s) => s.unreadChannels);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [addHovered, setAddHovered] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const guildList = Object.values(guilds);

  const hasUnread = (guildId: string) => {
    const channels = getChannels(guildId);
    return channels.some((ch) => unreadChannels[ch.id]);
  };

  const navigateToGuild = (guildId: string) => {
    const lastChannel = getLastChannelForGuild(guildId);
    const channels = getChannels(guildId);

    let targetChannel: string | null = null;
    if (lastChannel && channels.some((c) => c.id === lastChannel)) {
      targetChannel = lastChannel;
    } else if (channels.length > 0) {
      // First text channel by position, fallback to first channel
      const textChannel = channels.find((c) => c.type === 0);
      targetChannel = textChannel?.id ?? channels[0].id;
    }

    if (targetChannel) {
      navigate(routes.channel(guildId, targetChannel));
    }
  };

  return (
    <>
      <div style={styles.root} className="guild-sidebar">
        {guildList.map((guild) => {
          const isActive = guild.id === activeGuildId;
          const isHovered = guild.id === hoveredId;
          const unread = !isActive && hasUnread(guild.id);

          return (
            <div key={guild.id} style={styles.wrapper}>
              {/* Left pill indicator */}
              {(isActive || isHovered || unread) && (
                <div
                  style={{
                    ...styles.pill,
                    ...(isActive ? styles.pillActive : isHovered ? styles.pillHover : styles.pillUnread),
                  }}
                />
              )}
              <Tooltip title={guild.name} placement="right">
                <div
                  style={{
                    ...styles.guildIcon,
                    ...(isActive ? styles.guildIconActive : isHovered ? styles.guildIconHover : {}),
                  }}
                  onClick={() => navigateToGuild(guild.id)}
                  onMouseEnter={() => setHoveredId(guild.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {guild.icon ? (
                    <img src={guild.icon} alt={guild.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    getAbbreviation(guild.name)
                  )}
                </div>
              </Tooltip>
            </div>
          );
        })}

        <div style={styles.separator} />

        <Tooltip title="Create Server" placement="right">
          <div
            style={{ ...styles.addButton, ...(addHovered ? styles.addButtonHover : {}) }}
            onClick={() => setDialogOpen(true)}
            onMouseEnter={() => setAddHovered(true)}
            onMouseLeave={() => setAddHovered(false)}
          >
            <PlusOutlined />
          </div>
        </Tooltip>
      </div>

      <CreateServerDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
