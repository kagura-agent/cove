import { useUserStore } from "../stores/useUserStore";
import { Avatar, Button, Typography } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import type { CSSProperties } from "react";

const barStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: "var(--space-sm)", padding: "0 var(--space-sm)",
  borderTop: "1px solid var(--border-subtle)", background: "var(--bg-overlay)",
  height: "var(--footer-height)", flexShrink: 0,
};
const avatarStyle: CSSProperties = { backgroundColor: "var(--accent-brand)", color: "var(--text-on-accent)", fontWeight: 700, flexShrink: 0 };
const nameStyle: CSSProperties = { flex: 1, fontSize: 13, fontWeight: 500, color: "var(--text-normal)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const settingsBtnStyle: CSSProperties = { color: "var(--interactive-normal)", fontSize: "var(--font-size-md)" };

export function UserBar({ onCloseSidebar, onSettingsOpen }: { onCloseSidebar?: () => void; onSettingsOpen?: () => void }) {
  const { username } = useUserStore();

  const handleSettingsClick = () => {
    onCloseSidebar?.();
    onSettingsOpen?.();
  };

  return (
    <div style={barStyle}>
      <Avatar style={avatarStyle} size={28}>
        {username.charAt(0).toUpperCase()}
      </Avatar>
      <Typography.Text ellipsis style={nameStyle}>{username}</Typography.Text>
      <Button type="text" icon={<SettingOutlined />} onClick={handleSettingsClick} style={settingsBtnStyle} />
    </div>
  );
}
