import { create } from "zustand";

interface UserState {
  id: string;
  username: string;
  needsSetup: boolean;
  setUser: (username: string) => void;
}

function loadUser(): { id: string; username: string } | null {
  const saved = localStorage.getItem("cove-user");
  if (!saved) return null;
  try { return JSON.parse(saved); } catch { return null; }
}

const existing = loadUser();

export const useUserStore = create<UserState>((set) => ({
  id: existing?.id ?? "",
  username: existing?.username ?? "",
  needsSetup: !existing,
  setUser: (username: string) => {
    const id = username.toLowerCase().replace(/[^a-z0-9]/g, "-") || "islander";
    const user = { id, username };
    localStorage.setItem("cove-user", JSON.stringify(user));
    set({ id, username, needsSetup: false });
  },
}));
