import { create } from "zustand";

interface UserState {
  id: string;
  username: string;
  avatar: string | null;
  needsSetup: boolean;
  setUser: (user: { id: string; username: string; avatar: string | null }) => void;
  logout: () => void;
}

function hasToken(): boolean {
  return !!localStorage.getItem("cove-token");
}

export const useUserStore = create<UserState>((set) => ({
  id: "",
  username: "",
  avatar: null,
  needsSetup: !hasToken(),
  setUser: (user) => {
    set({ id: user.id, username: user.username, avatar: user.avatar, needsSetup: false });
  },
  logout: () => {
    localStorage.removeItem("cove-token");
    localStorage.removeItem("cove-user");
    set({ id: "", username: "", avatar: null, needsSetup: true });
  },
}));
