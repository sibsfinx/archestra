import type { MemoryEntry, MemoryTier } from "@/lib/memory.query";

export const CORE_CAP_PER_SCOPE = 50;
export const MEMORY_INJECTION_TOTAL_CAP = 50;
export const MEMORY_PAGE_SIZE = 25;

export type MemoryTierFilter = "all" | MemoryTier;

export function filterMemoriesByTeam(
  memories: MemoryEntry[],
  teamId: string | null,
): MemoryEntry[] {
  if (!teamId) return memories;
  return memories.filter((memory) => memory.teamId === teamId);
}

export function filterMemoriesByTier(
  memories: MemoryEntry[],
  tierFilter: MemoryTierFilter,
): MemoryEntry[] {
  if (tierFilter === "all") return memories;
  return memories.filter((memory) => memory.tier === tierFilter);
}

export function filterMemoriesBySearch(
  memories: MemoryEntry[],
  searchTerm: string,
): MemoryEntry[] {
  const query = searchTerm.trim().toLowerCase();
  if (!query) return memories;
  return memories.filter((memory) =>
    memory.content.toLowerCase().includes(query),
  );
}

export function countCoreMemoriesInScope(memories: MemoryEntry[]): number {
  return memories.filter((memory) => memory.tier === "core").length;
}

export function paginateMemories<T>(
  items: T[],
  page: number,
  pageSize: number,
): { pageItems: T[]; totalPages: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const start = (safePage - 1) * pageSize;
  return {
    pageItems: items.slice(start, start + pageSize),
    totalPages: pageCount,
    pageCount: safePage,
  };
}

export function browseMemories(params: {
  memories: MemoryEntry[];
  teamId: string | null;
  tierFilter: MemoryTierFilter;
  searchTerm: string;
  page: number;
  pageSize?: number;
}) {
  const pageSize = params.pageSize ?? MEMORY_PAGE_SIZE;
  const teamScoped = filterMemoriesByTeam(params.memories, params.teamId);
  const tierFiltered = filterMemoriesByTier(teamScoped, params.tierFilter);
  const searched = filterMemoriesBySearch(tierFiltered, params.searchTerm);
  const coreCount = countCoreMemoriesInScope(teamScoped);
  const { pageItems, totalPages, pageCount } = paginateMemories(
    searched,
    params.page,
    pageSize,
  );

  return {
    teamScoped,
    browsed: searched,
    pageItems,
    totalPages,
    pageCount,
    coreCount,
  };
}
