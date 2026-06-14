import { useEffect, useState, useCallback } from "react";
import { Button, Spin, Input, Popconfirm } from "antd";
import {
  FileTextOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  SaveOutlined,
  CloseOutlined,
  ArrowLeftOutlined,
  PushpinFilled,
} from "@ant-design/icons";
import { useChannelFilesStore } from "../stores/useChannelFilesStore";
import type { CSSProperties } from "react";

const { TextArea } = Input;

const styles = {
  root: {
    width: "var(--member-list-width)",
    minWidth: "var(--member-list-width)",
    flexShrink: 0,
    background: "var(--bg-secondary)",
    borderLeft: "1px solid var(--border-subtle)",
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    paddingTop: "var(--header-height)",
  } as CSSProperties,
  header: {
    padding: "var(--space-lg) var(--space-lg) var(--space-xs)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  } as CSSProperties,
  fileItem: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-sm)",
    padding: "var(--space-sm) var(--space-lg)",
    borderRadius: "var(--space-xs)",
    cursor: "pointer",
    transition: "background 0.15s",
  } as CSSProperties,
  fileItemHover: {
    background: "var(--member-hover)",
  } as CSSProperties,
  fileItemSelected: {
    background: "var(--bg-modifier-selected, var(--member-hover))",
  } as CSSProperties,
  filename: {
    fontSize: "var(--font-size-md)",
    color: "var(--text-normal)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
    flex: 1,
  } as CSSProperties,
  fileSize: {
    fontSize: "var(--font-size-xs)",
    color: "var(--text-muted)",
    flexShrink: 0,
  } as CSSProperties,
  pinBadge: {
    color: "var(--accent-brand, var(--accent))",
    fontSize: "var(--font-size-xs)",
    flexShrink: 0,
  } as CSSProperties,
  loading: {
    display: "flex",
    justifyContent: "center",
    padding: "var(--space-xxl)",
  } as CSSProperties,
  editorArea: {
    padding: "var(--space-md) var(--space-lg)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-sm)",
    flex: 1,
    minHeight: 0,
  } as CSSProperties,
  editorHeader: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-sm)",
    justifyContent: "space-between",
  } as CSSProperties,
  editorFilename: {
    fontWeight: 600,
    fontSize: "var(--font-size-md)",
    color: "var(--text-normal)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
  } as CSSProperties,
  editorActions: {
    display: "flex",
    gap: "var(--space-xs)",
    flexShrink: 0,
  } as CSSProperties,
  newFileRow: {
    padding: "var(--space-sm) var(--space-lg)",
    display: "flex",
    gap: "var(--space-xs)",
    alignItems: "center",
  } as CSSProperties,
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function FileRow({
  filename,
  size,
  isCoveMd,
  selected,
  onClick,
}: {
  filename: string;
  size: number;
  isCoveMd: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        ...styles.fileItem,
        ...(hovered ? styles.fileItemHover : {}),
        ...(selected ? styles.fileItemSelected : {}),
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <FileTextOutlined style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      <span style={styles.filename}>{filename}</span>
      {isCoveMd && <PushpinFilled style={styles.pinBadge} title="Auto-injected into bot context" />}
      <span style={styles.fileSize}>{formatSize(size)}</span>
    </div>
  );
}

export function FilesSidebar({ channelId }: { channelId: string }) {
  const {
    files,
    loading,
    selectedFile,
    fileContent,
    fileLoading,
    fetchFiles,
    fetchFile,
    saveFile,
    deleteFile,
    selectFile,
    clearFileContent,
  } = useChannelFilesStore();

  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [showNewFile, setShowNewFile] = useState(false);

  useEffect(() => {
    fetchFiles(channelId);
  }, [channelId, fetchFiles]);

  const handleFileClick = useCallback(
    (filename: string) => {
      selectFile(filename);
      fetchFile(channelId, filename);
      setEditing(false);
    },
    [channelId, fetchFile, selectFile]
  );

  const handleEdit = useCallback(() => {
    if (fileContent) {
      setEditContent(fileContent.content);
      setEditing(true);
    }
  }, [fileContent]);

  const handleSave = useCallback(async () => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      await saveFile(channelId, selectedFile, editContent);
      setEditing(false);
    } catch {
      // error logged in store
    } finally {
      setSaving(false);
    }
  }, [channelId, selectedFile, editContent, saveFile]);

  const handleDelete = useCallback(async () => {
    if (!selectedFile) return;
    await deleteFile(channelId, selectedFile);
  }, [channelId, selectedFile, deleteFile]);

  const handleCreateFile = useCallback(async () => {
    const name = newFileName.trim();
    if (!name) return;
    setSaving(true);
    try {
      await saveFile(channelId, name, "");
      setNewFileName("");
      setShowNewFile(false);
      handleFileClick(name);
    } catch {
      // error logged in store
    } finally {
      setSaving(false);
    }
  }, [channelId, newFileName, saveFile, handleFileClick]);

  const handleBack = useCallback(() => {
    clearFileContent();
    setEditing(false);
  }, [clearFileContent]);

  // File detail view
  if (selectedFile) {
    return (
      <div style={styles.root} className="files-sidebar scroll-container">
        <div style={styles.editorArea}>
          <div style={styles.editorHeader}>
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              size="small"
              onClick={handleBack}
              style={{ color: "var(--text-muted)" }}
            />
            <span style={styles.editorFilename}>{selectedFile}</span>
            <div style={styles.editorActions}>
              {editing ? (
                <>
                  <Button
                    type="text"
                    icon={<SaveOutlined />}
                    size="small"
                    onClick={handleSave}
                    loading={saving}
                    style={{ color: "var(--accent-brand, var(--accent))" }}
                  />
                  <Button
                    type="text"
                    icon={<CloseOutlined />}
                    size="small"
                    onClick={() => setEditing(false)}
                    style={{ color: "var(--text-muted)" }}
                  />
                </>
              ) : (
                <>
                  <Button
                    type="text"
                    icon={<EditOutlined />}
                    size="small"
                    onClick={handleEdit}
                    style={{ color: "var(--text-muted)" }}
                  />
                  <Popconfirm
                    title={`Delete ${selectedFile}?`}
                    onConfirm={handleDelete}
                    okText="Delete"
                    cancelText="Cancel"
                    okButtonProps={{ danger: true }}
                  >
                    <Button
                      type="text"
                      icon={<DeleteOutlined />}
                      size="small"
                      style={{ color: "var(--danger, #e74c3c)" }}
                    />
                  </Popconfirm>
                </>
              )}
            </div>
          </div>

          {fileLoading ? (
            <div style={styles.loading}>
              <Spin />
            </div>
          ) : editing ? (
            <TextArea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              autoSize={{ minRows: 8, maxRows: 24 }}
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "var(--font-size-sm)",
                background: "var(--bg-primary)",
                color: "var(--text-normal)",
                border: "1px solid var(--border-subtle)",
              }}
            />
          ) : (
            <pre
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "var(--font-size-sm)",
                color: "var(--text-normal)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                margin: 0,
                padding: "var(--space-sm)",
                background: "var(--bg-primary)",
                borderRadius: "var(--space-xs)",
                flex: 1,
                overflowY: "auto",
              }}
            >
              {fileContent?.content ?? ""}
            </pre>
          )}
        </div>
      </div>
    );
  }

  // File list view
  return (
    <div style={styles.root} className="files-sidebar scroll-container">
      <div style={styles.header}>
        <span>Files — {files.length}</span>
        <Button
          type="text"
          icon={<PlusOutlined />}
          size="small"
          onClick={() => setShowNewFile(!showNewFile)}
          style={{ color: "var(--text-muted)" }}
        />
      </div>

      {showNewFile && (
        <div style={styles.newFileRow}>
          <Input
            placeholder="filename.md"
            size="small"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onPressEnter={handleCreateFile}
            style={{ flex: 1 }}
          />
          <Button
            type="primary"
            size="small"
            onClick={handleCreateFile}
            loading={saving}
          >
            Create
          </Button>
        </div>
      )}

      {loading ? (
        <div style={styles.loading}>
          <Spin />
        </div>
      ) : files.length === 0 ? (
        <div
          style={{
            padding: "var(--space-xxl) var(--space-lg)",
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: "var(--font-size-sm)",
          }}
        >
          No files yet. Create one to get started.
        </div>
      ) : (
        files.map((f) => (
          <FileRow
            key={f.filename}
            filename={f.filename}
            size={f.size}
            isCoveMd={f.filename === "cove.md"}
            selected={selectedFile === f.filename}
            onClick={() => handleFileClick(f.filename)}
          />
        ))
      )}
    </div>
  );
}
