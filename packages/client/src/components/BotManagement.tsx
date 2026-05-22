import { useEffect } from "react";
import { useBotStore } from "../stores/useBotStore";
import { List, Button, Popconfirm } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { BotCreateForm } from "./BotCreateForm";

export function BotManagement() {
  const { bots, fetchBots, deleteBot } = useBotStore();

  useEffect(() => { fetchBots().catch(console.error); }, [fetchBots]);

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
                avatar={<span style={{ fontSize: 24 }}>{bot.emoji || "🤖"}</span>}
                title={bot.username}
                description={bot.bio}
              />
            </List.Item>
          )}
          style={{ marginBottom: 16 }}
        />
      )}
      <BotCreateForm />
    </div>
  );
}
