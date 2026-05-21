import { useState } from "react";
import { useUserStore } from "../stores/useUserStore";
import { Avatar, Button, Space, Typography } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import { SettingsPanel } from "./SettingsPanel";

export function UserBar() {
  const { username } = useUserStore();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderTop: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.15)" }}>
        <Avatar style={{ backgroundColor: "#f4a261", color: "#1a1a2e", fontWeight: 700, flexShrink: 0 }} size={32}>
          {username.charAt(0).toUpperCase()}
        </Avatar>
        <Typography.Text ellipsis style={{ flex: 1, fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{username}</Typography.Text>
        <Button type="text" icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)} style={{ color: "var(--text-secondary)" }} />
      </div>
      <SettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
