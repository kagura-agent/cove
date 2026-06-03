/**
 * Decorative per-user avatar background colors.
 * These are a fixed palette independent of theme — same pattern as Discord's
 * user color system. They provide visual distinction between users, not
 * semantic meaning, so they don't vary with light/dark theme.
 */

export const MESSAGE_AVATAR_COLORS = [
  "#5865f2", "#57f287", "#fee75c", "#eb459e",
  "#ed4245", "#f47b67", "#e78284", "#3ba55d",
];

export const MEMBER_AVATAR_COLORS = [
  "#f4a261", "#e76f51", "#2a9d8f", "#264653",
  "#e9c46a", "#606c38", "#bc6c25",
];

export function pickAvatarColor(name: string, palette: string[] = MESSAGE_AVATAR_COLORS): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
}
