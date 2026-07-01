import type { Memory } from "@/types/memory";

/** Max core memories injected into a prompt across all scopes combined. */
export const MEMORY_INJECTION_TOTAL_CAP = 50;

function compareMemoryRecency(a: Memory, b: Memory): number {
  const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
  if (timeDiff !== 0) return timeDiff;
  return a.id.localeCompare(b.id);
}

/** Merge per-scope core memory buckets into one injection list. */
export function mergeCoreMemoriesForInjection(buckets: Memory[][]): Memory[] {
  const nonEmpty = buckets.filter((bucket) => bucket.length > 0);
  if (nonEmpty.length === 0) return [];

  let representatives = nonEmpty.map(
    (bucket) => [...bucket].sort(compareMemoryRecency)[0]!,
  );

  if (representatives.length > MEMORY_INJECTION_TOTAL_CAP) {
    representatives = [...representatives]
      .sort(compareMemoryRecency)
      .slice(0, MEMORY_INJECTION_TOTAL_CAP);
  }

  const representativeIds = new Set(representatives.map((memory) => memory.id));
  const leftovers = nonEmpty
    .flat()
    .filter((memory) => !representativeIds.has(memory.id))
    .sort(compareMemoryRecency);

  const merged = [...representatives];
  for (const memory of leftovers) {
    if (merged.length >= MEMORY_INJECTION_TOTAL_CAP) break;
    merged.push(memory);
  }

  return merged.sort(compareMemoryRecency);
}
