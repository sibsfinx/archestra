import type { ResourceVisibilityScope } from "@/types/visibility";
import { requireScopedModifyPermission } from "./agent-type-permissions";
import { getPermissionsForUserContext } from "./utils";

export interface MemoryPermissionChecker {
  canRead: boolean;
  isAdmin: boolean;
  isTeamAdmin: boolean;
}

export async function getMemoryPermissionChecker(params: {
  userId: string;
  organizationId: string;
}): Promise<MemoryPermissionChecker> {
  const permissions = await getPermissionsForUserContext({
    userId: params.userId,
    organizationId: params.organizationId,
  });
  const memory = permissions.memory ?? [];
  return {
    canRead: memory.includes("read"),
    isAdmin: memory.includes("admin"),
    isTeamAdmin: memory.includes("team-admin"),
  };
}

export function requireMemoryModifyPermission(params: {
  checker: MemoryPermissionChecker;
  visibility: ResourceVisibilityScope;
  ownerUserId: string | null;
  teamId: string | null;
  userTeamIds: string[];
  userId: string;
}): void {
  requireScopedModifyPermission({
    isAdmin: params.checker.isAdmin,
    isTeamAdmin: params.checker.isTeamAdmin,
    scope: params.visibility,
    authorId: params.ownerUserId,
    resourceTeamIds: params.teamId ? [params.teamId] : [],
    userTeamIds: params.userTeamIds,
    userId: params.userId,
    resourceLabel: "memory",
  });
}
