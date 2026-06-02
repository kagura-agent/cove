import { useState } from "react";
import { useUserStore } from "../stores/useUserStore";
import { Avatar, Button, Typography } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import { SettingsPanel } from "./SettingsPanel";
import type { CSSProperties } from "react";

const barStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: 12, padding: 12,
  borderTop: "1px solid var(--border-subtle)", background: "var(--bg-overlay)",
};
const avatarStyle: CSSProperties = { backgroundColor: "var(--accent-brand)", color: "var(--bg-tertiary)", fontWeight: 700, flexShrink: 0 };
const nameStyle: CSSProperties = { flex: 1, fontSize: 14, fontWeight: 500, color: "var(--text-normal)" };
const settingsBtnStyle: CSSProperties = { color: "var(--interactive-normal)" };

export function UserBar({ onCloseSidebar }: { onCloseSidebar?: () => void }) {
  const { username } = useUserStore();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <div style={barStyle}>
        <Avatar style={avatarStyle} size={32}>
          {username.charAt(0).toUpperCase()}
        </Avatar>
        <Typography.Text ellipsis style={nameStyle}>{username}</Typography.Text>
        <Button type="text" icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)} style={settingsBtnStyle} />
      </div>
      <SettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} onCloseSidebar={onCloseSidebar} />
    </>
  );
}
