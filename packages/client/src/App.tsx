import { useEffect, useState } from "react";
import { useUserStore } from "./stores/useUserStore";
import { useChannelStore } from "./stores/useChannelStore";
import { useWebSocketStore } from "./stores/useWebSocketStore";
import { Sidebar } from "./components/Sidebar";
import { ChatArea } from "./components/ChatArea";
import { getChannelIcon } from "./lib/icons";
import * as api from "./lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Button } from "./components/ui/button";
import { Menu } from "lucide-react";

function UsernameDialog() {
  const [name, setName] = useState("");
  const setUser = useUserStore((s) => s.setUser);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setUser(name.trim() || "Islander");
  }

  return (
    <Dialog open>
      <DialogContent>
        <DialogHeader><DialogTitle>Welcome to Cove 🏝️</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-sm text-text-muted">What's your name?</p>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Islander" autoFocus />
          </div>
          <Button type="submit" className="w-full">Enter Cove</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function App() {
  const needsSetup = useUserStore((s) => s.needsSetup);
  const { channels, activeChannelId, setChannels, setActiveChannel } = useChannelStore();
  const connect = useWebSocketStore((s) => s.connect);
  const wsStatus = useWebSocketStore((s) => s.status);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const activeChannel = channels.find((c) => c.id === activeChannelId);

  useEffect(() => {
    if (needsSetup) return;
    api.fetchChannels().then((chs) => {
      setChannels(chs);
      if (chs.length > 0) setActiveChannel(chs[0].id);
    }).catch(console.error);
    connect();
  }, [needsSetup, setChannels, setActiveChannel, connect]);

  if (needsSetup) return <UsernameDialog />;

  return (
    <div className="flex h-full">
      {/* Mobile header */}
      <header className="sm:hidden fixed top-0 left-0 right-0 z-10 flex items-center gap-3 px-3.5 h-[52px] bg-bg-surface border-b border-border">
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 rounded-lg text-text-primary hover:bg-bg-card cursor-pointer" aria-label="Toggle channels">
          <Menu className="w-5 h-5" />
        </button>
        <h1 className="flex-1 text-lg font-semibold truncate">
          {activeChannel ? `${getChannelIcon(activeChannel)} ${activeChannel.name}` : "Cove 🏝️"}
        </h1>
      </header>

      {sidebarOpen && <div className="sm:hidden fixed inset-0 bg-black/50 z-20" onClick={() => setSidebarOpen(false)} />}

      <aside className={`fixed sm:static top-0 bottom-0 z-30 w-[80%] max-w-[300px] sm:w-[260px] sm:min-w-[260px] sm:max-w-none border-r border-border transition-[left] duration-250 ease-in-out sm:left-0 ${sidebarOpen ? "left-0 shadow-[4px_0_20px_rgba(0,0,0,0.4)]" : "-left-full"}`}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </aside>

      <main className="flex-1 flex flex-col min-w-0 pt-[52px] sm:pt-0">
        {wsStatus !== "connected" && (
          <div className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs text-text-muted bg-bg-card border-b border-border">
            <span className={`w-2 h-2 rounded-full ${wsStatus === "connecting" ? "bg-yellow-400 animate-pulse-dot" : "bg-red-500"}`} />
            <span>{wsStatus === "connecting" ? "Connecting…" : "Disconnected"}</span>
          </div>
        )}
        <ChatArea />
      </main>
    </div>
  );
}
