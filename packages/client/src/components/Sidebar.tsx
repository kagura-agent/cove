import { useChannelStore } from "../stores/useChannelStore";
import { getChannelIcon } from "../lib/icons";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { UserBar } from "./UserBar";
import * as api from "../lib/api";
import { useState } from "react";

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const { channels, activeChannelId, setActiveChannel, removeChannel, setChannels } = useChannelStore();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState("🏝️");

  function handleSelectChannel(id: string) {
    setActiveChannel(id);
    onClose?.();
  }

  async function handleDeleteChannel(id: string, name: string) {
    if (!confirm(`Delete #${name}? All messages will be lost.`)) return;
    try {
      await api.deleteChannel(id);
      removeChannel(id);
    } catch (err) { console.error("delete channel:", err); }
  }

  async function handleAddChannel(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const ch = await api.createChannel(newName.trim(), newIcon || "🏝️");
      setChannels([...channels, ch]);
      setNewName("");
      setNewIcon("🏝️");
      setAdding(false);
    } catch (err) { console.error("create channel:", err); }
  }

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="p-5 pb-3.5 border-b border-border">
        <h1 className="text-[22px] font-bold tracking-tight">🏝️ Cove</h1>
        <p className="text-xs text-muted-foreground mt-0.5">island scenes</p>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        {channels.map((ch) => (
          <div key={ch.id} className="flex items-center group relative">
            <button onClick={() => handleSelectChannel(ch.id)} className={`flex-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] text-[15px] text-left transition-all cursor-pointer ${ch.id === activeChannelId ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
              <span className="text-xl w-7 text-center shrink-0">{getChannelIcon(ch)}</span>
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">{ch.name}</span>
            </button>
            <button onClick={() => handleDeleteChannel(ch.id, ch.name)} className="hidden group-hover:block absolute right-2 text-muted-foreground/60 hover:text-red-500 hover:bg-red-500/10 px-2 py-1 rounded text-sm cursor-pointer" title="Delete channel">×</button>
          </div>
        ))}
        {adding ? (
          <form onSubmit={handleAddChannel} className="p-2 space-y-2 mt-2">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Channel name" autoFocus />
            <div className="flex gap-2">
              <Input value={newIcon} onChange={(e) => setNewIcon(e.target.value)} placeholder="Icon" className="w-16" />
              <Button type="submit" size="sm" className="flex-1">Create</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <button onClick={() => setAdding(true)} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] text-[15px] text-muted-foreground opacity-50 hover:opacity-100 border border-dashed border-border mt-2 cursor-pointer">
            <span className="text-xl w-7 text-center">➕</span>
            <span>New channel</span>
          </button>
        )}
      </nav>
      <UserBar />
    </div>
  );
}
