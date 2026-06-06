import { create } from "zustand";

interface UserState {
  id: string;
  username: string;
  avatar: string | null;
  needsSetup: boolean;
  setUser: (user: { id: string; username: string; avatar: string | null }) => void;
  logout: () => void;
}

export const useUserStore = create<UserState>((set) => ({
  id: "",
  username: "",
  avatar: null,
  needsSetup: true, // BFF: default true, set false after successful fetchMe()
  setUser: (user) => {
    set({ id: user.id, username: user.username, avatar: user.avatar, needsSetup: false });
  },
  logout: () => {
    set({ id: "", username: "", avatar: null, needsSetup: true });
  },
}));
