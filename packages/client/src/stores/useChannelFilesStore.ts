import { create } from "zustand";
import type { ChannelFileMeta, ChannelFile } from "../lib/api";
import * as api from "../lib/api";

interface ChannelFilesState {
  files: ChannelFileMeta[];
  filesOpen: boolean;
  loading: boolean;
  selectedFile: string | null;
  fileContent: ChannelFile | null;
  fileLoading: boolean;

  toggleFiles: () => void;
  setFilesOpen: (open: boolean) => void;
  fetchFiles: (channelId: string) => Promise<void>;
  fetchFile: (channelId: string, filename: string) => Promise<void>;
  saveFile: (channelId: string, filename: string, content: string) => Promise<void>;
  deleteFile: (channelId: string, filename: string) => Promise<void>;
  selectFile: (filename: string | null) => void;
  clearFileContent: () => void;
}

export const useChannelFilesStore = create<ChannelFilesState>((set, get) => ({
  files: [],
  filesOpen: false,
  loading: false,
  selectedFile: null,
  fileContent: null,
  fileLoading: false,

  toggleFiles: () => set((s) => ({ filesOpen: !s.filesOpen })),
  setFilesOpen: (open) => set({ filesOpen: open }),

  fetchFiles: async (channelId) => {
    set({ loading: true });
    try {
      const files = await api.getChannelFiles(channelId);
      set({ files, loading: false });
    } catch (err) {
      console.error("fetchFiles:", err);
      set({ loading: false });
    }
  },

  fetchFile: async (channelId, filename) => {
    set({ fileLoading: true, selectedFile: filename });
    try {
      const file = await api.getChannelFile(channelId, filename);
      set({ fileContent: file, fileLoading: false });
    } catch (err) {
      console.error("fetchFile:", err);
      set({ fileContent: null, fileLoading: false });
    }
  },

  saveFile: async (channelId, filename, content) => {
    try {
      await api.putChannelFile(channelId, filename, content);
      // Refresh file list
      await get().fetchFiles(channelId);
      // Refresh file content if it's the currently viewed file
      if (get().selectedFile === filename) {
        await get().fetchFile(channelId, filename);
      }
    } catch (err) {
      console.error("saveFile:", err);
      throw err;
    }
  },

  deleteFile: async (channelId, filename) => {
    try {
      await api.deleteChannelFile(channelId, filename);
      const state = get();
      // Clear selection if deleted file was selected
      if (state.selectedFile === filename) {
        set({ selectedFile: null, fileContent: null });
      }
      // Refresh file list
      await get().fetchFiles(channelId);
    } catch (err) {
      console.error("deleteFile:", err);
      throw err;
    }
  },

  selectFile: (filename) => set({ selectedFile: filename, fileContent: null }),
  clearFileContent: () => set({ selectedFile: null, fileContent: null }),
}));
