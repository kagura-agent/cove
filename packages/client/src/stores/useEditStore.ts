import { create } from "zustand";

interface EditState {
  editingMessage: { channelId: string; messageId: string; content: string } | null;
  startEditing: (channelId: string, messageId: string, content: string) => void;
  stopEditing: () => void;
}

export const useEditStore = create<EditState>((set) => ({
  editingMessage: null,
  startEditing: (channelId, messageId, content) =>
    set({ editingMessage: { channelId, messageId, content } }),
  stopEditing: () => set({ editingMessage: null }),
}));
