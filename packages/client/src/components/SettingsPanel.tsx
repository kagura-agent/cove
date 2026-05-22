import { useState } from "react";
import { useUserStore } from "../stores/useUserStore";
import { Drawer, Input, Button, Tabs } from "antd";
import { BotManagement } from "./BotManagement";

export function SettingsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { username, setUser } = useUserStore();
  const [newName, setNewName] = useState(username);

  function handleSaveName() {
    if (newName.trim()) setUser(newName.trim());
  }

  return (
    <Drawer open={open} onClose={() => onOpenChange(false)} title="Settings" placement="right" width={400}>
      <Tabs
        items={[
          {
            key: "profile",
            label: "Profile",
            children: (
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 8 }}>Username</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} onPressEnter={handleSaveName} style={{ flex: 1 }} />
                  <Button type="primary" onClick={handleSaveName}>Save</Button>
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
