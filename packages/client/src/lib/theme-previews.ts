/**
 * Theme preset preview data for the settings panel theme picker.
 * These colors are intentionally hardcoded — they represent what each
 * theme LOOKS LIKE as a preview swatch, not the current theme's tokens.
 */

import type { ThemePreset } from "../stores/useThemeStore";

export interface ThemePreviewData {
  key: ThemePreset;
  label: string;
  preview: {
    bg: string;
    sidebar: string;
    accent: string;
    lineColor: string;
    borderColor: string;
    labelColor: string;
  };
}

export const THEME_PRESETS: ThemePreviewData[] = [
  {
    key: "light",
    label: "Light",
    preview: {
      bg: "#ffffff",
      sidebar: "#f2f3f5",
      accent: "#5865f2",
      lineColor: "rgba(0,0,0,0.12)",
      borderColor: "rgba(0,0,0,0.08)",
      labelColor: "#313338",
    },
  },
  {
    key: "dark",
    label: "Dark",
    preview: {
      bg: "#313338",
      sidebar: "#2b2d31",
      accent: "#5865f2",
      lineColor: "rgba(255,255,255,0.15)",
      borderColor: "rgba(255,255,255,0.06)",
      labelColor: "#dbdee1",
    },
  },
  {
    key: "midnight",
    label: "Midnight",
    preview: {
      bg: "#1a191d",
      sidebar: "#111113",
      accent: "#5865f2",
      lineColor: "rgba(255,255,255,0.15)",
      borderColor: "rgba(255,255,255,0.06)",
      labelColor: "#dbdee1",
    },
  },
];
