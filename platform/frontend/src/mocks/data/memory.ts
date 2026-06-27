export type MockMemory = {
  id: string;
  content: string;
  visibility: "personal" | "team" | "org";
  tier: "core" | "archival";
  userId: string;
  organizationId: string;
  teamId: string | null;
  createdBy: string;
  taintedAtWrite: boolean;
  createdAt: string;
  updatedAt: string;
};

export const memoriesSeed: MockMemory[] = [];

export function makeMemory(
  overrides: Partial<MockMemory> = {},
): MockMemory {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    content: "Prefers morning standups at 9am",
    visibility: "personal",
    tier: "core",
    userId: "test-user-admin",
    organizationId: "test-org",
    teamId: null,
    createdBy: "test-user-admin",
    taintedAtWrite: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
