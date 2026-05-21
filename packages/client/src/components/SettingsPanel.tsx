import { useState } from "react";
import { useUserStore } from "../stores/useUserStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { BotManagement } from "./BotManagement";

export function SettingsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { username, setUser } = useUserStore();
  const [newName, setNewName] = useState(username);

  function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    if (newName.trim()) setUser(newName.trim());
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Settings</DialogTitle></DialogHeader>
        <div className="space-y-6 mt-4">
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider">Profile</h3>
            <form onSubmit={handleSaveName} className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="username">Username</Label>
                <Input id="username" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </div>
              <Button type="submit" className="self-end">Save</Button>
            </form>
          </section>
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider">Bot Management</h3>
            <BotManagement />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
