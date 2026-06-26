import type { ResourceVisibilityScope } from "@archestra/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useHasPermissions } from "@/lib/auth/auth.query";
import { handleApiError, toApiError } from "@/lib/utils";

export type MemoryTier = "core" | "archival";
export type MemoryVisibility = ResourceVisibilityScope;

export interface MemoryEntry {
  id: string;
  organizationId: string;
  tier: MemoryTier;
  visibility: MemoryVisibility;
  userId: string | null;
  teamId: string | null;
  content: string;
  createdBy: string;
  taintedAtWrite: boolean;
  createdAt: string;
  updatedAt: string;
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
    handleApiError(error);
    throw toApiError(error);
  }

  return response.json() as Promise<T>;
}

export function useMemories(
  visibility: MemoryVisibility,
  options?: { enabled?: boolean },
) {
  const { data: canReadMemories } = useHasPermissions({ memory: ["read"] });

  return useQuery({
    queryKey: ["memories", visibility],
    queryFn: async () => {
      const result = await memoryRequest<{ data: MemoryEntry[] }>(
        `/api/memory?visibility=${encodeURIComponent(visibility)}`,
      );
      return result.data ?? [];
    },
    enabled: (options?.enabled ?? true) && !!canReadMemories,
  });
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
