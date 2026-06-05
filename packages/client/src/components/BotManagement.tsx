import { useEffect, useState } from "react";
import { useBotStore } from "../stores/useBotStore";
import { List, Button, Popconfirm, Spin } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { BotCreateForm } from "./BotCreateForm";

export function BotManagement() {
  const { bots, fetchBots, deleteBot } = useBotStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBots().catch(console.error).finally(() => setLoading(false));
  }, [fetchBots]);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-xxl)" }}>
        <Spin tip="Loading bots…" />
      </div>
    );
  }

  return (
    <div>
      {bots.length > 0 && (
        <List
          dataSource={bots}
          renderItem={(bot) => (
            <List.Item
              actions={[
                <Popconfirm key="delete" title={`Delete bot "${bot.username}"?`} onConfirm={() => deleteBot(bot.id)} okText="Delete" cancelText="Cancel" okButtonProps={{ danger: true }}>
                  <Button type="text" icon={<DeleteOutlined />} danger size="small" />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                avatar={<span style={{ fontSize: "var(--space-xxl)" }}>🤖</span>}
                title={bot.username}
                description={bot.bio}
              />
            </List.Item>
          )}
          style={{ marginBottom: "var(--space-lg)" }}
        />
      )}
      <BotCreateForm />
    </div>
  );
}
