/**
 * Decorative per-user avatar background colors.
 * These are a fixed palette independent of theme — same pattern as Discord's
 * user color system. They provide visual distinction between users, not
 * semantic meaning, so they don't vary with light/dark theme.
 */

export const AVATAR_COLORS = [
  "#5865f2", "#57f287", "#fee75c", "#eb459e",
  "#ed4245", "#f47b67", "#e78284", "#3ba55d",
];

export function getContrastTextColor(hexColor: string): string {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

export function pickAvatarColor(name: string, palette: string[] = AVATAR_COLORS): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
}
