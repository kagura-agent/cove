/**
 * Compare two message ids. Message ids are snowflakes (numeric strings);
 * compare as BigInt to avoid float precision loss on 64-bit ids.
 * Returns <0 if a < b, 0 if equal, >0 if a > b.
 */
export function compareIds(a: string, b: string): number {
  const ai = BigInt(a);
  const bi = BigInt(b);
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}
