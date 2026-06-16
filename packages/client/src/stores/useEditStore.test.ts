import { describe, it, expect, beforeEach } from "vitest";
import { useEditStore } from "./useEditStore";

describe("useEditStore", () => {
  beforeEach(() => {
    useEditStore.getState().stopEditing();
  });

  it("starts with null editing state", () => {
    expect(useEditStore.getState().editingMessage).toBeNull();
  });

  it("startEditing sets the editing message", () => {
    useEditStore.getState().startEditing("ch1", "msg1", "hello");
    const state = useEditStore.getState().editingMessage;
    expect(state).toEqual({
      channelId: "ch1",
      messageId: "msg1",
      content: "hello",
    });
  });

  it("stopEditing clears the editing message", () => {
    useEditStore.getState().startEditing("ch1", "msg1", "hello");
    useEditStore.getState().stopEditing();
    expect(useEditStore.getState().editingMessage).toBeNull();
  });

  it("startEditing replaces previous edit", () => {
    useEditStore.getState().startEditing("ch1", "msg1", "first");
    useEditStore.getState().startEditing("ch2", "msg2", "second");
    expect(useEditStore.getState().editingMessage).toEqual({
      channelId: "ch2",
      messageId: "msg2",
      content: "second",
    });
  });
});
