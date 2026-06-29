import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal, Input, Button, message } from "antd";
import { useGuildStore } from "../stores/useGuildStore";
import { useChannelStore } from "../stores/useChannelStore";
import * as api from "../lib/api";
import { routes } from "../lib/routes";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateServerDialog({ open, onClose }: Props) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      message.error("Server name must be at least 2 characters");
      return;
    }
    if (trimmed.length > 100) {
      message.error("Server name must be at most 100 characters");
      return;
    }

    setLoading(true);
    try {
      const guild = await api.createGuild(trimmed);
      // Add guild to store
      useGuildStore.getState().addGuild({
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        owner_id: guild.owner_id,
        features: [],
      });
      // Add channels to store
      if (guild.channels?.length) {
        useChannelStore.getState().setChannels(guild.id, guild.channels);
      }
      // Navigate to the new guild's #general
      const generalChannel = guild.channels?.[0];
      if (generalChannel) {
        navigate(routes.channel(guild.id, generalChannel.id));
      }
      setName("");
      onClose();
    } catch (err: any) {
      message.error(err?.message ?? "Failed to create server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="Create a Server"
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 8 }}>
        <div>
          <label style={{ display: "block", marginBottom: 4, fontWeight: 500, color: "var(--text-normal)" }}>
            Server Name
          </label>
          <Input
            placeholder="My Server"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={handleCreate}
            maxLength={100}
            autoFocus
          />
        </div>
        <Button
          type="primary"
          onClick={handleCreate}
          loading={loading}
          disabled={name.trim().length < 2}
          block
        >
          Create
        </Button>
      </div>
    </Modal>
  );
}
