import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useGuildStore } from "../stores/useGuildStore";
import { useChannelStore } from "../stores/useChannelStore";
import { routes } from "../lib/routes";

export function RedirectToDefault() {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const channelsLoaded = useChannelStore((s) => s.channelsLoaded);
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (!channelsLoaded || redirectedRef.current) return;
    const guilds = useGuildStore.getState().guilds;
    const channelsByGuildId = useChannelStore.getState().channelsByGuildId;
    const guildIds = Object.keys(guilds);
    if (guildIds.length === 0) return;
    const guildId = guildIds[0];
    const channels = channelsByGuildId[guildId] ?? [];
    if (channels.length > 0) {
      redirectedRef.current = true;
      navigateRef.current(routes.channel(guildId, channels[0].id), { replace: true });
    }
  }, [channelsLoaded]);

  return null;
}
