import { useEffect, useState } from "react";
import { Avatar, Spin } from "antd";
import * as api from "../lib/api";
import type { GuildMember } from "../types";
import type { CSSProperties } from "react";

const styles = {
  root: { width: 240, minWidth: 240, height: "100%", background: "var(--bg-secondary)", borderLeft: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", overflowY: "auto" } as CSSProperties,
  header: { padding: "12px 16px 8px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)" } as CSSProperties,
  member: { display: "flex", alignItems: "center", gap: 10, padding: "6px 16px", borderRadius: 4, cursor: "default", transition: "background 0.15s" } as CSSProperties,
  memberHover: { background: "var(--member-hover)" } as CSSProperties,
  avatar: { flexShrink: 0 } as CSSProperties,
  username: { fontSize: 14, color: "var(--text-normal)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as CSSProperties,
  badge: { fontSize: 10, fontWeight: 700, padding: "1px 4px", borderRadius: 3, background: "var(--accent)", color: "var(--header-primary)", marginLeft: 4, flexShrink: 0 } as CSSProperties,
  loading: { display: "flex", justifyContent: "center", padding: 24 } as CSSProperties,
};

/* Avatar colors — decorative per-user colors, not theme tokens (same as Discord). */
const AVATAR_COLORS = ["#f4a261", "#e76f51", "#2a9d8f", "#264653", "#e9c46a", "#606c38", "#bc6c25"];

function hashColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function MemberRow({ member }: { member: GuildMember }) {
  const [hovered, setHovered] = useState(false);
  const user = member.user;
  return (
    <div
      style={{ ...styles.member, ...(hovered ? styles.memberHover : {}) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Avatar size={32} style={{ backgroundColor: hashColor(user.username), color: "var(--header-primary)", fontWeight: 700, ...styles.avatar }}>
        {user.username.charAt(0).toUpperCase()}
      </Avatar>
      <span style={styles.username}>{member.nick || user.username}</span>
      {user.bot && <span style={styles.badge}>BOT</span>}
    </div>
  );
}

export function MemberList() {
  const [members, setMembers] = useState<GuildMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.fetchMembers()
      .then(setMembers)
      .catch((err) => console.error("fetch members:", err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={styles.root}>
        <div style={styles.loading}><Spin /></div>
      </div>
    );
  }

  const humans = members.filter((m) => !m.user.bot);
  const bots = members.filter((m) => m.user.bot);

  return (
    <div style={styles.root} className="member-list">
      {humans.length > 0 && (
        <>
          <div style={styles.header}>Online — {humans.length}</div>
          {humans.map((m) => <MemberRow key={m.user.id} member={m} />)}
        </>
      )}
      {bots.length > 0 && (
        <>
          <div style={{ ...styles.header, marginTop: humans.length > 0 ? 12 : 0 }}>Bots — {bots.length}</div>
          {bots.map((m) => <MemberRow key={m.user.id} member={m} />)}
        </>
      )}
    </div>
  );
}
