import { create } from "zustand";

interface UserState {
  id: string;
  username: string;
  avatar: string | null;
  global_name: string | null;
  needsSetup: boolean;
  setUser: (user: { id: string; username: string; avatar: string | null; global_name?: string | null }) => void;
  setGlobalName: (name: string | null) => void;
  logout: () => void;
}

export const useUserStore = create<UserState>((set) => ({
  id: "",
  username: "",
  avatar: null,
  global_name: null,
  needsSetup: true,
  setUser: (user) => {
    set({ id: user.id, username: user.username, avatar: user.avatar, global_name: user.global_name ?? null, needsSetup: false });
  },
  setGlobalName: (name) => {
    set({ global_name: name });
  },
  logout: () => {
    set({ id: "", username: "", avatar: null, global_name: null, needsSetup: true });
  },
}));
