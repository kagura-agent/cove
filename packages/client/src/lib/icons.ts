import type { Channel } from "../types";

const CHANNEL_ICONS: Record<string, string> = {
  campfire: "🔥", beach: "🏖️", forest: "🌲", cave: "🕳️",
  harbor: "⚓", market: "🏪", tavern: "🍺", garden: "🌺",
  lighthouse: "🗼", library: "📚", workshop: "🔧", general: "💬",
  home: "🏠", post: "📮",
};

export function getChannelIcon(ch: Channel): string {
  if (ch.icon) return ch.icon;
  const name = ch.name.toLowerCase();
  for (const [key, icon] of Object.entries(CHANNEL_ICONS)) {
    if (name.includes(key)) return icon;
  }
  return "🏝️";
}
