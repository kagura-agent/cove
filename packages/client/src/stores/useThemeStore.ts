import { create } from "zustand";

export type ThemePreset = "dark" | "midnight";

interface ThemeState {
  theme: ThemePreset;
  setTheme: (theme: ThemePreset) => void;
}

function applyTheme(theme: ThemePreset) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("cove-theme", theme);
}

function loadTheme(): ThemePreset {
  const stored = localStorage.getItem("cove-theme");
  if (stored === "dark" || stored === "midnight") return stored;
  return "midnight";
}

const initial = loadTheme();
applyTheme(initial);

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initial,
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));
