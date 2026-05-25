import { useUserStore } from "../stores/useUserStore";
import { Drawer, Tabs, Typography, Button } from "antd";
import { BotManagement } from "./BotManagement";

export function SettingsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { username, logout } = useUserStore();

  return (
    <Drawer open={open} onClose={() => onOpenChange(false)} title="Settings" placement="right" width={400}>
      <Tabs
        items={[
          {
            key: "profile",
            label: "Profile",
            children: (
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 8 }}>Signed in as</label>
                <Typography.Text strong>{username}</Typography.Text>
                <div style={{ marginTop: 16 }}>
                  <Button danger onClick={logout}>Sign out</Button>
                </div>
              </div>
            ),
          },
          {
            key: "bots",
            label: "Bots",
            children: <BotManagement />,
          },
        ]}
      />
    </Drawer>
  );
}
