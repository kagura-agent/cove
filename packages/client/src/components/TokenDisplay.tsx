import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Copy, Check } from "lucide-react";

export function TokenDisplay({ token, onClose }: { token: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Bot Token Created</DialogTitle></DialogHeader>
        <div className="mt-4 space-y-3">
          <p className="text-sm text-text-muted">Copy this token now. You won't be able to see it again.</p>
          <div className="flex gap-2">
            <code className="flex-1 bg-bg-card p-3 rounded-lg text-xs break-all text-accent font-mono">{token}</code>
            <Button variant="outline" size="icon" onClick={handleCopy} className="shrink-0">
              {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-xs text-red-400">Warning: This token provides full access to the bot account. Keep it secret.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
