import { useParams } from "react-router-dom";

export function useActiveIds() {
  const { guildId, channelId, threadId } = useParams();
  return { guildId: guildId ?? null, channelId: channelId ?? null, threadId: threadId ?? null };
}
