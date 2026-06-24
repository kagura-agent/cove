import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useGuildStore } from "../stores/useGuildStore";
import { useChannelStore } from "../stores/useChannelStore";
import { routes } from "../lib/routes";

export function RedirectToDefault() {
  const navigate = useNavigate();
  const guilds = useGuildStore((s) => s.guilds);
  const channelsByGuildId = useChannelStore((s) => s.channelsByGuildId);
  const channelsLoaded = useChannelStore((s) => s.channelsLoaded);

  useEffect(() => {
    if (!channelsLoaded) return;
    const guildIds = Object.keys(guilds);
    if (guildIds.length === 0) return;
    const guildId = guildIds[0];
    const channels = channelsByGuildId[guildId] ?? [];
    if (channels.length > 0) {
      navigate(routes.channel(guildId, channels[0].id), { replace: true });
    }
  }, [channelsLoaded, guilds, channelsByGuildId, navigate]);

  return null;
}
