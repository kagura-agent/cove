import { useChannelStore } from "../stores/useChannelStore";
import { getChannelIcon } from "../lib/icons";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";

export function ChatArea() {
  const { channels, activeChannelId } = useChannelStore();
  const channel = channels.find((c) => c.id === activeChannelId);

  if (!channel) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-text-dim gap-3">
        <span className="text-5xl">🌴</span>
        <p className="text-[15px]">Select a scene from the sidebar</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="hidden sm:flex items-center gap-3 px-5 py-3 bg-bg-surface border-b border-border min-h-[52px]">
        <span className="text-[28px]">{getChannelIcon(channel)}</span>
        <div className="flex-1">
          <h2 className="text-[17px] font-semibold">{channel.name}</h2>
          <p className="text-xs text-text-muted mt-px">{channel.topic || "A cozy scene"}</p>
        </div>
      </div>
      <MessageList channelId={channel.id} />
      <MessageInput channelId={channel.id} />
    </div>
  );
}
