import { Modal, Input, Alert, message } from "antd";
import { CopyOutlined } from "@ant-design/icons";

export function TokenDisplay({ token, onClose }: { token: string; onClose: () => void }) {
  async function handleCopy() {
    await navigator.clipboard.writeText(token);
    message.success("Token copied to clipboard");
  }

  return (
    <Modal open onCancel={onClose} title="Bot Token Created" footer={null} centered>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Copy this token now. You won't be able to see it again.</p>
        <Input.Search
          value={token}
          readOnly
          enterButton={<CopyOutlined />}
          onSearch={handleCopy}
          style={{ fontFamily: "monospace", fontSize: 12 }}
        />
        <Alert type="error" message="Warning: This token provides full access to the bot account. Keep it secret." showIcon />
      </div>
    </Modal>
  );
}
