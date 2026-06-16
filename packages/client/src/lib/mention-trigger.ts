/**
 * Detect mention trigger (@ or #) with word boundary check.
 * Returns the query string and start position, or null if no valid trigger.
 */
export function detectMentionTrigger(
  text: string,
  cursorPos: number,
  triggerChar: '@' | '#',
): { query: string; start: number } | null {
  const beforeCursor = text.slice(0, cursorPos);
  const pattern = triggerChar === '@' ? /@(\w*)$/ : /#([\w-]*)$/;
  const match = beforeCursor.match(pattern);
  if (!match) return null;

  const triggerIndex = beforeCursor.length - match[0].length;
  // Word boundary check: trigger must be preceded by whitespace, start of string, or punctuation (not a word char)
  if (triggerIndex > 0 && /\w/.test(beforeCursor[triggerIndex - 1])) {
    return null;
  }

  return { query: match[1].toLowerCase(), start: triggerIndex };
}
