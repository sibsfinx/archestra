import config from "@/config";
import OrganizationModel from "@/models/organization";
import { ApiError } from "@/types";

function isMemoryGloballyEnabled(): boolean {
  return config.memory.enabled;
}

function assertMemoryGloballyEnabled(): void {
  if (!isMemoryGloballyEnabled()) {
    throw new ApiError(404, "Not found");
  }
}

async function isMemoryEnabledForOrganization(
  organizationId: string,
): Promise<boolean> {
  if (!isMemoryGloballyEnabled()) {
    return false;
  }
  const organization = await OrganizationModel.getById(organizationId);
  return organization?.memoryEnabled === true;
}

export async function assertMemoryEnabledForOrganization(
  organizationId: string,
): Promise<void> {
  assertMemoryGloballyEnabled();
  if (!(await isMemoryEnabledForOrganization(organizationId))) {
    throw new ApiError(403, "Durable memory is disabled for this organization");
  }
}
