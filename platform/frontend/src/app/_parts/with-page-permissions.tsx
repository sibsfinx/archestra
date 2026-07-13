"use client";

import { requiredPagePermissionsMap } from "@archestra/shared/access-control";
import { usePathname } from "next/navigation";
import type React from "react";
import { ForbiddenPage } from "@/app/_parts/forbidden-page";
import { useAllPermissions, useHasPermissions } from "@/lib/auth/auth.query";
import { canAccessMemorySettings } from "@/lib/auth/auth.utils";

export const WithPagePermissions: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const pathname = usePathname();

  const isMemorySettingsPage = pathname === "/settings/memory";
  const { data: userPermissions, isLoading: permissionsLoading } =
    useAllPermissions();

  // Get required permissions for current page
  const requiredPermissions = requiredPagePermissionsMap[pathname];
  const { data: hasRequiredPermissions, isPending } = useHasPermissions(
    requiredPermissions || {},
  );

  if (isMemorySettingsPage) {
    if (permissionsLoading) {
      return null;
    }
    if (!canAccessMemorySettings(userPermissions)) {
      return <ForbiddenPage />;
    }
    return <>{children}</>;
  }

  // Show loading while checking permissions
  if (isPending && requiredPermissions) {
    return null;
  }

  // Show forbidden page if user doesn't have required permissions
  if (requiredPermissions && !hasRequiredPermissions) {
    return <ForbiddenPage />;
  }

  return <>{children}</>;
};
