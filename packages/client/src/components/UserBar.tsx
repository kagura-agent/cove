import { useState } from "react";
import { useUserStore } from "../stores/useUserStore";
import { Settings } from "lucide-react";
import { SettingsPanel } from "./SettingsPanel";

export function UserBar() {
  const { username } = useUserStore();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-3 p-3 border-t border-border bg-bg-deep/50">
        <div className="w-8 h-8 rounded-full bg-accent text-bg-deep flex items-center justify-center font-bold text-sm shrink-0">
          {username.charAt(0).toUpperCase()}
        </div>
        <span className="flex-1 text-sm font-medium truncate">{username}</span>
        <button onClick={() => setSettingsOpen(true)} className="text-text-muted hover:text-text-primary p-1.5 rounded-lg hover:bg-bg-card transition-colors cursor-pointer" title="Settings">
          <Settings className="w-4 h-4" />
        </button>
      </div>
      <SettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
