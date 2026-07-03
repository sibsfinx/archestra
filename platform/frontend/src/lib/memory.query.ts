import type { ResourceVisibilityScope } from "@archestra/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useHasPermissions } from "@/lib/auth/auth.query";
import { organizationKeys } from "@/lib/organization.query";
import { handleApiError, toApiError } from "@/lib/utils";

export type MemoryTier = "core" | "archival";
export type MemoryVisibility = ResourceVisibilityScope;
export type MemoryAccessLevel = "personal" | "team" | "organization";
export type MemorySourceKind = "manual" | "agent";

export interface MemoryEntry {
  id: string;
  organizationId: string;
  tier: MemoryTier;
  visibility: MemoryVisibility;
  userId: string | null;
  teamId: string | null;
  content: string;
  createdBy: string;
  createdByName?: string;
  writtenByAgentId: string | null;
  sourceKind: MemorySourceKind;
  taintedAtWrite: boolean;
  createdAt: string;
  updatedAt: string;
}

type MemoriesResponse = {
  data: MemoryEntry[];
  memoryAccessLevel: MemoryAccessLevel;
};

export function memoryVisibilitiesForAccessLevel(
  level: MemoryAccessLevel,
): MemoryVisibility[] {
  switch (level) {
    case "personal":
      return ["personal"];
    case "team":
      return ["personal", "team"];
    case "organization":
      return ["personal", "team", "org"];
  }
}

export function highestMemoryTabForAccessLevel(
  level: MemoryAccessLevel,
): MemoryVisibility {
  if (level === "organization") return "org";
  if (level === "team") return "team";
  return "personal";
}

type CreateMemoryInput = {
  content: string;
  visibility: MemoryVisibility;
  teamId?: string;
  tier?: MemoryTier;
};

type UpdateMemoryInput = {
  id: string;
  visibility: MemoryVisibility;
  content?: string;
  tier?: MemoryTier;
};

type DeleteMemoryInput = {
  id: string;
  visibility: MemoryVisibility;
};

async function memoryRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let error: unknown;
    try {
      error = await response.json();
    } catch {
      error = { message: `Request failed (${response.status})` };
    }
    const apiError = toApiError(error);
    if (response.status === 403) {
      throw Object.assign(apiError, { httpStatus: 403 as const });
    }
    handleApiError(error);
    throw apiError;
  }

  return response.json() as Promise<T>;
}

export function useMemories(
  visibility: MemoryVisibility,
  options?: { enabled?: boolean },
) {
  const queryClient = useQueryClient();
  const { data: canReadMemories } = useHasPermissions({ memory: ["read"] });

  return useQuery({
    queryKey: ["memories", visibility],
    queryFn: async () => {
      try {
        const result = await memoryRequest<MemoriesResponse>(
          `/api/memory?visibility=${encodeURIComponent(visibility)}`,
        );
        return {
          memories: result.data ?? [],
          memoryAccessLevel: result.memoryAccessLevel ?? "organization",
        };
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "httpStatus" in error &&
          (error as { httpStatus?: number }).httpStatus === 403
        ) {
          await queryClient.invalidateQueries({
            queryKey: organizationKeys.details(),
          });
        }
        throw error;
      }
    },
    enabled: (options?.enabled ?? true) && !!canReadMemories,
  });
}

export function useMemoryAccessLevel(options?: { enabled?: boolean }) {
  const query = useMemories("personal", options);
  return {
    ...query,
    data: query.data?.memoryAccessLevel,
  };
}

export function useCreateMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: CreateMemoryInput) => {
      return memoryRequest<MemoryEntry>("/api/memory", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: (_data, variables) => {
      toast.success("Memory added");
      queryClient.invalidateQueries({
        queryKey: ["memories", variables.visibility],
      });
    },
  });
}

export function useUpdateMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, content, tier }: UpdateMemoryInput) => {
      return memoryRequest<MemoryEntry>(`/api/memory/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...(content !== undefined ? { content } : {}),
          ...(tier !== undefined ? { tier } : {}),
        }),
      });
    },
    onSuccess: (_data, variables) => {
      toast.success("Memory updated");
      queryClient.invalidateQueries({
        queryKey: ["memories", variables.visibility],
      });
    },
  });
}

export function useDeleteMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: DeleteMemoryInput) => {
      return memoryRequest<{ success: boolean }>(`/api/memory/${id}`, {
        method: "DELETE",
      });
    },
    onSuccess: (_data, variables) => {
      toast.success("Memory deleted");
      queryClient.invalidateQueries({
        queryKey: ["memories", variables.visibility],
      });
    },
  });
}
