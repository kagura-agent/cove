import { useUserStore } from "../stores/useUserStore";
import { usePresenceStore } from "../stores/usePresenceStore";
import { Avatar, Button, Typography } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import type { CSSProperties } from "react";
import { pickAvatarColor, getContrastTextColor } from "../lib/avatar-palette";
import { StatusDot } from "./StatusDot";

const barStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: "var(--space-sm)", padding: "0 var(--space-sm)",
  borderTop: "1px solid var(--border-subtle)", background: "var(--bg-overlay)",
  height: "100%", boxSizing: "border-box",
};
const avatarStyle: CSSProperties = { color: "var(--text-on-accent)", fontWeight: 700, flexShrink: 0 };
const nameStyle: CSSProperties = { flex: 1, fontSize: 13, fontWeight: 500, color: "var(--text-normal)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const settingsBtnStyle: CSSProperties = { color: "var(--interactive-normal)", fontSize: "var(--font-size-md)" };

export function UserBar({ onCloseSidebar, onSettingsOpen }: { onCloseSidebar?: () => void; onSettingsOpen?: () => void }) {
  const { id, username } = useUserStore();
  const online = usePresenceStore((s) => s.isOnline(id));

  const handleSettingsClick = () => {
    onCloseSidebar?.();
    onSettingsOpen?.();
  };

  return (
    <div style={barStyle}>
      <div style={{ position: "relative", display: "inline-block" }}>
        <Avatar style={{ ...avatarStyle, backgroundColor: pickAvatarColor(username), color: getContrastTextColor(pickAvatarColor(username)) }} size={28}>
          {username.charAt(0).toUpperCase()}
        </Avatar>
        <StatusDot online={online} />
      </div>
      <Typography.Text ellipsis style={nameStyle}>{username}</Typography.Text>
      <Button type="text" icon={<SettingOutlined />} onClick={handleSettingsClick} style={settingsBtnStyle} />
    </div>
  );
}
