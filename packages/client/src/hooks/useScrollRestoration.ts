import { useEffect, type RefObject } from "react";

const scrollPositions = new Map<string, number>();

export function useScrollRestoration(
  channelId: string,
  scrollRef: RefObject<HTMLElement | null>,
) {
  // Save position on unmount / channel switch
  useEffect(() => {
    const el = scrollRef.current;
    return () => {
      if (el) scrollPositions.set(channelId, el.scrollTop);
    };
  }, [channelId]);

  // Restore position on mount / channel switch
  useEffect(() => {
    const el = scrollRef.current;
    const saved = scrollPositions.get(channelId);
    if (el && saved !== undefined) {
      el.scrollTop = saved;
    }
  }, [channelId]);
}
