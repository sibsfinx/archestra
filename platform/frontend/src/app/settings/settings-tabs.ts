import { requiredPagePermissionsMap } from "@archestra/shared/access-control";
import {
  useAllPermissions,
  useHasPermissions,
  usePermissionMap,
} from "@/lib/auth/auth.query";
import { canAccessMemorySettings } from "@/lib/auth/auth.utils";
import { useFeature } from "@/lib/config/config.query";
import config from "@/lib/config/config";
import { useOrganization } from "@/lib/organization.query";

import { useSecretsType } from "@/lib/secrets.query";

export function useSettingsTabs() {
  const permissionMap = usePermissionMap(requiredPagePermissionsMap);
  const { data: userPermissions } = useAllPermissions();
  const { data: secretsType } = useSecretsType();
  const memoryGloballyEnabled = useFeature("memoryEnabled") ?? true;
  const { data: organization } = useOrganization();
  const { data: isMemoryAdmin } = useHasPermissions({ memory: ["admin"] });
  const memoryOrgEnabled = organization?.memoryEnabled !== false;
  const canAccessMemory = canAccessMemorySettings(userPermissions);
  const showMemoryTab =
    memoryGloballyEnabled &&
    ((memoryOrgEnabled && canAccessMemory) ||
      (!memoryOrgEnabled && !!isMemoryAdmin));

  return [
    { label: "Your Account", href: "/settings/account" },
    ...(permissionMap?.["/settings/api-keys"]
      ? [{ label: "API Keys", href: "/settings/api-keys" }]
      : []),
    ...(permissionMap?.["/settings/service-accounts"]
      ? [{ label: "Service Accounts", href: "/settings/service-accounts" }]
      : []),
    ...(permissionMap?.["/settings/agents"]
      ? [{ label: "Agents", href: "/settings/agents" }]
      : []),
    ...(permissionMap?.["/settings/llm"]
      ? [{ label: "LLM", href: "/settings/llm" }]
      : []),
    ...(permissionMap?.["/settings/knowledge"]
      ? [{ label: "Knowledge", href: "/settings/knowledge" }]
      : []),
    ...(showMemoryTab
      ? [{ label: "Memory", href: "/settings/memory" }]
      : []),
    ...(permissionMap?.["/settings/environments"]
      ? [{ label: "Environments", href: "/settings/environments" }]
      : []),
    ...(permissionMap?.["/settings/users"]
      ? [{ label: "Users", href: "/settings/users" }]
      : []),
    ...(permissionMap?.["/settings/teams"]
      ? [{ label: "Teams", href: "/settings/teams" }]
      : []),
    ...(permissionMap?.["/settings/roles"]
      ? [{ label: "Roles", href: "/settings/roles" }]
      : []),
    ...(permissionMap?.["/settings/github"]
      ? [{ label: "GitHub", href: "/settings/github" }]
      : []),
    ...(config.enterpriseFeatures.core &&
    permissionMap?.["/settings/identity-providers"]
      ? [{ label: "Identity Providers", href: "/settings/identity-providers" }]
      : []),
    ...(secretsType?.type === "Vault" && permissionMap?.["/settings/secrets"]
      ? [{ label: "Secrets", href: "/settings/secrets" }]
      : []),
    ...(permissionMap?.["/settings/organization"]
      ? [{ label: "Organization", href: "/settings/organization" }]
      : []),
  ];
}
