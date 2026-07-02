import { create } from "zustand";

type SectionKey = "appearance" | "profile" | "bots";

interface SettingsState {
  open: boolean;
  initialSection?: SectionKey;
  openTo: (section: SectionKey) => void;
  openSettings: () => void;
  close: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  open: false,
  initialSection: undefined,
  openTo: (section) => set({ open: true, initialSection: section }),
  openSettings: () => set({ open: true, initialSection: undefined }),
  close: () => set({ open: false, initialSection: undefined }),
}));
