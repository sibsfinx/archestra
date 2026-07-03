// biome-ignore-all lint/suspicious/noExplicitAny: test
import {
  ARCHESTRA_MCP_SERVER_NAME,
  MCP_SERVER_TOOL_NAME_SEPARATOR,
  TOOL_MEMORY_SHORT_NAME,
} from "@archestra/shared";
import { count, eq } from "drizzle-orm";
import db, { schema } from "@/database";
import { OrganizationModel } from "@/models";
import { beforeEach, describe, expect, test } from "@/test";
import type { Agent, InsertMemory } from "@/types";
import { MAX_CORE_ITEMS_PER_SCOPE } from "./memory";
import { type ArchestraContext, executeArchestraTool } from ".";

const t = (name: string) =>
  `${ARCHESTRA_MCP_SERVER_NAME}${MCP_SERVER_TOOL_NAME_SEPARATOR}${name}`;

function textOf(result: { content: unknown[] }): string {
  return (result.content[0] as any).text as string;
}

function memoriesFrom(result: { structuredContent?: unknown }): any[] {
  return ((result.structuredContent as any)?.memories ?? []) as any[];
}

async function seedMemory(values: InsertMemory) {
  const [row] = await db
    .insert(schema.memoriesTable)
    .values(values)
    .returning();
  return row;
}

describe("memory tool execution", () => {
  let agent: Agent;
  let organizationId: string;
  let userId: string;
  let otherUserId: string;
  let context: ArchestraContext;

  beforeEach(async ({ makeAgent, makeUser, makeMember, makeOrganization }) => {
    const org = await makeOrganization();
    organizationId = org.id;
    const user = await makeUser();
    const otherUser = await makeUser();
    await makeMember(user.id, organizationId, { role: "admin" });
    await makeMember(otherUser.id, organizationId, { role: "member" });
    userId = user.id;
    otherUserId = otherUser.id;
    agent = await makeAgent({ organizationId, name: "Memory Agent" });
    context = {
      agent: { id: agent.id, name: agent.name },
      organizationId,
      userId,
      contextIsTrusted: true,
    };
  });

  test("view and search never return another user's personal memory", async () => {
    await seedMemory({
      organizationId,
      visibility: "personal",
      userId: otherUserId,
      teamId: null,
      content: "other-user-secret-preference",
      tier: "core",
      createdBy: otherUserId,
    });

    const viewResult = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "view" },
      context,
    );
    expect(viewResult.isError).toBeFalsy();
    expect(memoriesFrom(viewResult)).toEqual([]);

    const searchResult = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "search", query: "secret-preference" },
      context,
    );
    expect(searchResult.isError).toBeFalsy();
    expect(memoriesFrom(searchResult)).toEqual([]);
  });

  test("team memory is visible to a member but not a non-member", async ({
    makeAgent,
    makeTeam,
    makeTeamMember,
    makeUser,
    makeMember,
  }) => {
    const member = await makeUser();
    const outsider = await makeUser();
    await makeMember(member.id, organizationId, { role: "member" });
    await makeMember(outsider.id, organizationId, { role: "member" });

    const team = await makeTeam(organizationId, userId);
    await makeTeamMember(team.id, member.id);

    const teamAgent = await makeAgent({
      organizationId,
      scope: "team",
      teams: [team.id],
      name: "Team Memory Agent",
    });

    await seedMemory({
      organizationId,
      visibility: "team",
      userId: null,
      teamId: team.id,
      content: "team-shared-runbook",
      tier: "core",
      createdBy: userId,
    });

    const memberContext: ArchestraContext = {
      agent: { id: teamAgent.id, name: teamAgent.name },
      organizationId,
      userId: member.id,
      contextIsTrusted: true,
    };
    const outsiderContext: ArchestraContext = {
      agent: { id: teamAgent.id, name: teamAgent.name },
      organizationId,
      userId: outsider.id,
      contextIsTrusted: true,
    };

    const memberResult = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "search", query: "runbook" },
      memberContext,
    );
    expect(memoriesFrom(memberResult)).toHaveLength(1);
    expect(memoriesFrom(memberResult)[0].content).toBe("team-shared-runbook");

    const outsiderResult = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "search", query: "runbook" },
      outsiderContext,
    );
    expect(memoriesFrom(outsiderResult)).toEqual([]);
  });

  test("org memory is visible to any org user", async ({
    makeUser,
    makeMember,
  }) => {
    const orgUser = await makeUser();
    await makeMember(orgUser.id, organizationId, { role: "member" });

    await seedMemory({
      organizationId,
      visibility: "org",
      userId: null,
      teamId: null,
      content: "org-wide-policy",
      tier: "core",
      createdBy: userId,
    });

    const orgUserContext: ArchestraContext = {
      agent: { id: agent.id, name: agent.name },
      organizationId,
      userId: orgUser.id,
      contextIsTrusted: true,
    };

    const result = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "search", query: "policy" },
      orgUserContext,
    );

    expect(memoriesFrom(result)).toHaveLength(1);
    expect(memoriesFrom(result)[0].content).toBe("org-wide-policy");
  });

  test("create while tainted does not write a row and returns manual-add message", async () => {
    const taintedContext: ArchestraContext = {
      ...context,
      contextIsTrusted: false,
    };

    const result = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "create", content: "should-not-persist" },
      taintedContext,
    );

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("Settings → Memory");

    const [{ value: rowCount }] = await db
      .select({ value: count() })
      .from(schema.memoriesTable)
      .where(eq(schema.memoriesTable.content, "should-not-persist"));
    expect(rowCount).toBe(0);
  });

  test("duplicate create results in exactly one row", async ({ makeAgent }) => {
    const personalAgent = await makeAgent({
      organizationId,
      scope: "personal",
      authorId: userId,
    });
    const personalContext: ArchestraContext = {
      agent: { id: personalAgent.id, name: personalAgent.name },
      organizationId,
      userId,
      contextIsTrusted: true,
    };
    const args = { command: "create" as const, content: "duplicate-me" };

    const first = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      args,
      personalContext,
    );
    const second = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      args,
      personalContext,
    );

    expect(first.isError).toBeFalsy();
    expect(second.isError).toBeFalsy();
    expect(textOf(second)).toContain("already exists");

    const [{ value: rowCount }] = await db
      .select({ value: count() })
      .from(schema.memoriesTable)
      .where(eq(schema.memoriesTable.content, "duplicate-me"));
    expect(rowCount).toBe(1);
  });

  test("tool responses omit tier — tier is managed in Settings only", async () => {
    await seedMemory({
      organizationId,
      visibility: "personal",
      userId,
      teamId: null,
      content: "chat-visible-fact",
      tier: "core",
      createdBy: userId,
    });

    const searchResult = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "search", query: "chat-visible" },
      context,
    );
    expect(searchResult.isError).toBeFalsy();
    const searched = memoriesFrom(searchResult);
    expect(searched).toHaveLength(1);
    expect(searched[0]).not.toHaveProperty("tier");
    expect(searched[0].content).toBe("chat-visible-fact");

    const createResult = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "create", content: "agent-saved-from-chat" },
      context,
    );
    expect(createResult.isError).toBeFalsy();
    const created = (createResult.structuredContent as { memory?: unknown })
      ?.memory;
    expect(created).toBeDefined();
    expect(created).not.toHaveProperty("tier");
  });

  test("delete while tainted does not remove row and returns manual-add message", async () => {
    const memory = await seedMemory({
      organizationId,
      visibility: "personal",
      userId,
      teamId: null,
      content: "tainted-delete-target",
      tier: "core",
      createdBy: userId,
    });

    const taintedContext: ArchestraContext = {
      ...context,
      contextIsTrusted: false,
    };

    const result = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "delete", id: memory.id },
      taintedContext,
    );

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("Settings → Memory");

    const stillThere = await db
      .select()
      .from(schema.memoriesTable)
      .where(eq(schema.memoriesTable.id, memory.id));
    expect(stillThere).toHaveLength(1);
  });

  test("personal agent update to duplicate content returns controlled error", async ({
    makeAgent,
  }) => {
    const first = await seedMemory({
      organizationId,
      visibility: "personal",
      userId,
      teamId: null,
      content: "existing-content",
      tier: "core",
      createdBy: userId,
    });
    const second = await seedMemory({
      organizationId,
      visibility: "personal",
      userId,
      teamId: null,
      content: "other-content",
      tier: "core",
      createdBy: userId,
    });
    const personalAgent = await makeAgent({
      organizationId,
      scope: "personal",
      authorId: userId,
    });
    const personalContext: ArchestraContext = {
      agent: { id: personalAgent.id, name: personalAgent.name },
      organizationId,
      userId,
      contextIsTrusted: true,
    };

    const result = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "update", id: second.id, content: "existing-content" },
      personalContext,
    );

    expect(result.isError).toBeTruthy();
    expect(textOf(result)).toContain("Another memory already has this content");

    const unchanged = await db
      .select()
      .from(schema.memoriesTable)
      .where(eq(schema.memoriesTable.id, second.id));
    expect(unchanged[0]?.content).toBe("other-content");
    expect(first.id).not.toBe(second.id);
  });

  test("db scope check constraint rejects invalid team rows", async () => {
    await expect(
      db.insert(schema.memoriesTable).values({
        organizationId,
        visibility: "team",
        userId: null,
        teamId: null,
        content: "invalid-team-scope",
        tier: "core",
        createdBy: userId,
      }),
    ).rejects.toThrow();
  });

  test("read-only memory permission cannot create", async ({
    makeUser,
    makeMember,
    makeCustomRole,
  }) => {
    const readOnlyUser = await makeUser();
    const readOnlyRole = await makeCustomRole(organizationId, {
      permission: { memory: ["read"] },
    });
    await makeMember(readOnlyUser.id, organizationId, {
      role: readOnlyRole.role,
    });

    const readOnlyContext: ArchestraContext = {
      agent: { id: agent.id, name: agent.name },
      organizationId,
      userId: readOnlyUser.id,
      contextIsTrusted: true,
    };

    const result = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "create", content: "blocked-by-rbac" },
      readOnlyContext,
    );

    expect(result.isError).toBeTruthy();
    expect(textOf(result)).toContain("memory:create");

    const [{ value: rowCount }] = await db
      .select({ value: count() })
      .from(schema.memoriesTable)
      .where(eq(schema.memoriesTable.content, "blocked-by-rbac"));
    expect(rowCount).toBe(0);
  });

  test("view by id exposes org memory for org-targeted agents only", async ({
    makeTeam,
    makeTeamMember,
    makeAgent,
  }) => {
    const team = await makeTeam(organizationId, userId);
    await makeTeamMember(team.id, userId);

    const orgAgent = await makeAgent({ organizationId, scope: "org" });
    const orgContext: ArchestraContext = {
      agent: { id: orgAgent.id, name: orgAgent.name },
      organizationId,
      userId,
      contextIsTrusted: true,
    };

    const teamMemory = await seedMemory({
      organizationId,
      visibility: "team",
      userId: null,
      teamId: team.id,
      content: "team-view-by-id-hidden",
      tier: "core",
      createdBy: userId,
    });
    const orgMemory = await seedMemory({
      organizationId,
      visibility: "org",
      userId: null,
      teamId: null,
      content: "org-view-by-id-visible",
      tier: "core",
      createdBy: userId,
    });

    const teamView = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "view", id: teamMemory.id },
      orgContext,
    );
    const orgView = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "view", id: orgMemory.id },
      orgContext,
    );

    expect(teamView.isError).toBeFalsy();
    expect(orgView.isError).toBeFalsy();
    expect(memoriesFrom(teamView)).toEqual([]);
    expect(memoriesFrom(orgView)).toHaveLength(1);
    expect(memoriesFrom(orgView)[0].content).toBe("org-view-by-id-visible");
    expect(textOf(teamView)).toContain("No matching memory found");
  });

  test("read-only memory permission can search but cannot update or delete", async ({
    makeUser,
    makeMember,
    makeCustomRole,
  }) => {
    const readOnlyUser = await makeUser();
    const readOnlyRole = await makeCustomRole(organizationId, {
      permission: { memory: ["read"] },
    });
    await makeMember(readOnlyUser.id, organizationId, {
      role: readOnlyRole.role,
    });

    await seedMemory({
      organizationId,
      visibility: "personal",
      userId: readOnlyUser.id,
      teamId: null,
      content: "read-only-search-target",
      tier: "core",
      createdBy: readOnlyUser.id,
    });

    const readOnlyContext: ArchestraContext = {
      agent: { id: agent.id, name: agent.name },
      organizationId,
      userId: readOnlyUser.id,
      contextIsTrusted: true,
    };

    const searchResult = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "search", query: "read-only-search" },
      readOnlyContext,
    );
    expect(searchResult.isError).toBeFalsy();
    expect(memoriesFrom(searchResult)).toHaveLength(1);

    const updateResult = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      {
        command: "update",
        id: memoriesFrom(searchResult)[0].id,
        content: "blocked-update",
      },
      readOnlyContext,
    );
    expect(updateResult.isError).toBeTruthy();
    expect(textOf(updateResult)).toContain("memory:update");

    const deleteResult = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "delete", id: memoriesFrom(searchResult)[0].id },
      readOnlyContext,
    );
    expect(deleteResult.isError).toBeTruthy();
    expect(textOf(deleteResult)).toContain("memory:delete");
  });

  test("rejects execution when org durable memory is disabled", async () => {
    await OrganizationModel.patch(organizationId, { memoryEnabled: false });

    await expect(
      executeArchestraTool(
        t(TOOL_MEMORY_SHORT_NAME),
        { command: "view" },
        context,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("No tool named"),
    });
  });

  test("rejects assigned-agent execution when org durable memory is disabled", async () => {
    await OrganizationModel.patch(organizationId, { memoryEnabled: false });

    const agentContext: ArchestraContext = {
      ...context,
      agentId: agent.id,
    };

    await expect(
      executeArchestraTool(
        t(TOOL_MEMORY_SHORT_NAME),
        { command: "view" },
        agentContext,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("No tool named"),
    });
  });

  test("personal agent writes caller personal memory", async ({
    makeAgent,
  }) => {
    const personalAgent = await makeAgent({
      organizationId,
      scope: "personal",
      authorId: userId,
    });
    const personalContext: ArchestraContext = {
      agent: { id: personalAgent.id, name: personalAgent.name },
      organizationId,
      userId,
      contextIsTrusted: true,
    };

    const result = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "create", content: "personal-agent-save" },
      personalContext,
    );

    expect(result.isError).toBeFalsy();
    const [row] = await db
      .select()
      .from(schema.memoriesTable)
      .where(eq(schema.memoriesTable.content, "personal-agent-save"));
    expect(row?.visibility).toBe("personal");
    expect(row?.userId).toBe(userId);
    expect(row?.writtenByAgentId).toBe(personalAgent.id);
    expect(row?.sourceKind).toBe("agent");
    expect(row?.createdBy).toBe(userId);
  });

  test("org agent writes org memory with agent provenance", async ({
    makeAgent,
  }) => {
    const orgAgent = await makeAgent({ organizationId, scope: "org" });
    const orgContext: ArchestraContext = {
      agent: { id: orgAgent.id, name: orgAgent.name },
      organizationId,
      userId,
      contextIsTrusted: true,
    };

    const result = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "create", content: "org-agent-save" },
      orgContext,
    );

    expect(result.isError).toBeFalsy();
    const [row] = await db
      .select()
      .from(schema.memoriesTable)
      .where(eq(schema.memoriesTable.content, "org-agent-save"));
    expect(row?.visibility).toBe("org");
    expect(row?.writtenByAgentId).toBe(orgAgent.id);
    expect(row?.sourceKind).toBe("agent");
  });

  test("team agent fan-out writes one row per assigned team", async ({
    makeAgent,
    makeTeam,
  }) => {
    const teamA = await makeTeam(organizationId, userId);
    const teamB = await makeTeam(organizationId, userId);
    const teamAgent = await makeAgent({
      organizationId,
      scope: "team",
      teams: [teamA.id, teamB.id],
    });
    const teamContext: ArchestraContext = {
      agent: { id: teamAgent.id, name: teamAgent.name },
      organizationId,
      userId,
      contextIsTrusted: true,
    };

    const result = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "create", content: "team-fanout-save" },
      teamContext,
    );

    expect(result.isError).toBeFalsy();
    const rows = await db
      .select()
      .from(schema.memoriesTable)
      .where(eq(schema.memoriesTable.content, "team-fanout-save"));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.teamId).sort()).toEqual(
      [teamA.id, teamB.id].sort(),
    );
    expect(rows.every((row) => row.sourceKind === "agent")).toBe(true);
  });

  test("team agent with no teams fails gracefully on create", async ({
    makeAgent,
  }) => {
    const teamAgent = await makeAgent({
      organizationId,
      scope: "team",
      teams: [],
    });
    const teamContext: ArchestraContext = {
      agent: { id: teamAgent.id, name: teamAgent.name },
      organizationId,
      userId,
      contextIsTrusted: true,
    };

    const result = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "create", content: "team-empty-save" },
      teamContext,
    );

    expect(result.isError).toBeTruthy();
    expect(textOf(result)).toContain("no teams assigned");
  });

  test("sharedMemoryWriteEnabled=false blocks org writes", async ({
    makeAgent,
  }) => {
    const orgAgent = await makeAgent({
      organizationId,
      scope: "org",
      sharedMemoryWriteEnabled: false,
    });
    const orgContext: ArchestraContext = {
      agent: { id: orgAgent.id, name: orgAgent.name },
      organizationId,
      userId,
      contextIsTrusted: true,
    };

    const result = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "create", content: "blocked-org-save" },
      orgContext,
    );

    expect(result.isError).toBeTruthy();
    expect(textOf(result)).toContain("Shared memory writes are disabled");

    const [{ value: rowCount }] = await db
      .select({ value: count() })
      .from(schema.memoriesTable)
      .where(eq(schema.memoriesTable.content, "blocked-org-save"));
    expect(rowCount).toBe(0);
  });

  test("sharedMemoryWriteEnabled=false blocks org memory update and delete", async ({
    makeAgent,
  }) => {
    const orgAgent = await makeAgent({
      organizationId,
      scope: "org",
      sharedMemoryWriteEnabled: false,
    });
    const orgContext: ArchestraContext = {
      agent: { id: orgAgent.id, name: orgAgent.name },
      organizationId,
      userId,
      contextIsTrusted: true,
    };

    const memory = await seedMemory({
      organizationId,
      visibility: "org",
      userId: null,
      teamId: null,
      content: "blocked-org-update-target",
      tier: "core",
      createdBy: userId,
    });

    const updateResult = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      {
        command: "update",
        id: memory.id,
        content: "blocked-org-update-content",
      },
      orgContext,
    );
    expect(updateResult.isError).toBeTruthy();
    expect(textOf(updateResult)).toContain("Shared memory writes are disabled");

    const deleteResult = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "delete", id: memory.id },
      orgContext,
    );
    expect(deleteResult.isError).toBeTruthy();
    expect(textOf(deleteResult)).toContain("Shared memory writes are disabled");

    const [unchanged] = await db
      .select()
      .from(schema.memoriesTable)
      .where(eq(schema.memoriesTable.id, memory.id));
    expect(unchanged?.content).toBe("blocked-org-update-target");
  });

  test("sharedMemoryWriteEnabled=false still allows personal memory update", async ({
    makeAgent,
  }) => {
    const personalAgent = await makeAgent({
      organizationId,
      scope: "personal",
      authorId: userId,
      sharedMemoryWriteEnabled: false,
    });
    const personalContext: ArchestraContext = {
      agent: { id: personalAgent.id, name: personalAgent.name },
      organizationId,
      userId,
      contextIsTrusted: true,
    };

    const memory = await seedMemory({
      organizationId,
      visibility: "personal",
      userId,
      teamId: null,
      content: "personal-update-allowed",
      tier: "core",
      createdBy: userId,
    });

    const updateResult = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      {
        command: "update",
        id: memory.id,
        content: "personal-update-allowed-revised",
      },
      personalContext,
    );

    expect(updateResult.isError).toBeFalsy();
    const [updated] = await db
      .select()
      .from(schema.memoriesTable)
      .where(eq(schema.memoriesTable.id, memory.id));
    expect(updated?.content).toBe("personal-update-allowed-revised");
  });

  test("org agent cannot update or delete caller personal memory", async ({
    makeAgent,
  }) => {
    const orgAgent = await makeAgent({
      organizationId,
      scope: "org",
    });
    const orgContext: ArchestraContext = {
      agent: { id: orgAgent.id, name: orgAgent.name },
      organizationId,
      userId,
      contextIsTrusted: true,
    };

    const memory = await seedMemory({
      organizationId,
      visibility: "personal",
      userId,
      teamId: null,
      content: "personal-update-denied-through-org",
      tier: "core",
      createdBy: userId,
    });

    const updateResult = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      {
        command: "update",
        id: memory.id,
        content: "should-not-update-personal-through-org",
      },
      orgContext,
    );
    expect(updateResult.isError).toBeTruthy();
    expect(textOf(updateResult)).toContain("do not have permission to update");

    const deleteResult = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "delete", id: memory.id },
      orgContext,
    );
    expect(deleteResult.isError).toBeTruthy();
    expect(textOf(deleteResult)).toContain("do not have permission to delete");

    const [unchanged] = await db
      .select()
      .from(schema.memoriesTable)
      .where(eq(schema.memoriesTable.id, memory.id));
    expect(unchanged?.content).toBe("personal-update-denied-through-org");
  });

  test("team fan-out rolls back all rows when one team is not writable", async ({
    makeAgent,
    makeTeam,
    makeTeamMember,
    makeUser,
    makeMember,
    makeCustomRole,
  }) => {
    const teamA = await makeTeam(organizationId, userId);
    const teamB = await makeTeam(organizationId, userId);

    const teamAdminUser = await makeUser();
    const teamAdminRole = await makeCustomRole(organizationId, {
      permission: {
        memory: ["read", "create", "update", "delete", "team-admin"],
      },
    });
    await makeMember(teamAdminUser.id, organizationId, {
      role: teamAdminRole.role,
    });
    await makeTeamMember(teamA.id, teamAdminUser.id);

    const teamAgent = await makeAgent({
      organizationId,
      scope: "team",
      teams: [teamA.id, teamB.id],
    });
    const teamAdminContext: ArchestraContext = {
      agent: { id: teamAgent.id, name: teamAgent.name },
      organizationId,
      userId: teamAdminUser.id,
      contextIsTrusted: true,
    };

    const result = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "create", content: "partial-fanout-blocked" },
      teamAdminContext,
    );

    expect(result.isError).toBeTruthy();

    const [{ value: rowCount }] = await db
      .select({ value: count() })
      .from(schema.memoriesTable)
      .where(eq(schema.memoriesTable.content, "partial-fanout-blocked"));
    expect(rowCount).toBe(0);
  });

  test("team fan-out treats duplicate rows as idempotent before scope limits", async ({
    makeAgent,
    makeTeam,
  }) => {
    const teamA = await makeTeam(organizationId, userId);
    const teamB = await makeTeam(organizationId, userId);
    const teamAgent = await makeAgent({
      organizationId,
      scope: "team",
      teams: [teamA.id, teamB.id],
    });
    const teamContext: ArchestraContext = {
      agent: { id: teamAgent.id, name: teamAgent.name },
      organizationId,
      userId,
      contextIsTrusted: true,
    };

    await seedMemory({
      organizationId,
      visibility: "team",
      userId: null,
      teamId: teamA.id,
      content: "team-capacity-duplicate-ok",
      tier: "core",
      createdBy: userId,
    });
    for (let i = 1; i < MAX_CORE_ITEMS_PER_SCOPE; i += 1) {
      await seedMemory({
        organizationId,
        visibility: "team",
        userId: null,
        teamId: teamA.id,
        content: `team-a-fill-${i}`,
        tier: "core",
        createdBy: userId,
      });
    }

    const result = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "create", content: "team-capacity-duplicate-ok" },
      teamContext,
    );

    expect(result.isError).toBeFalsy();
    const rows = await db
      .select()
      .from(schema.memoriesTable)
      .where(eq(schema.memoriesTable.content, "team-capacity-duplicate-ok"));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.teamId).sort()).toEqual(
      [teamA.id, teamB.id].sort(),
    );
  });

  test("memory_access_level=personal blocks org search through org agent", async ({
    makeUser,
    makeMember,
    makeAgent,
  }) => {
    const restrictedUser = await makeUser();
    const memberRow = await makeMember(restrictedUser.id, organizationId);
    await db
      .update(schema.membersTable)
      .set({ memoryAccessLevel: "personal" })
      .where(eq(schema.membersTable.id, memberRow.id));

    const orgAgent = await makeAgent({ organizationId, scope: "org" });
    await seedMemory({
      organizationId,
      visibility: "org",
      userId: null,
      teamId: null,
      content: "org-ceiling-hidden",
      tier: "core",
      createdBy: userId,
    });
    await seedMemory({
      organizationId,
      visibility: "personal",
      userId: restrictedUser.id,
      teamId: null,
      content: "personal-ceiling-visible",
      tier: "core",
      createdBy: restrictedUser.id,
    });

    const restrictedContext: ArchestraContext = {
      agent: { id: orgAgent.id, name: orgAgent.name },
      organizationId,
      userId: restrictedUser.id,
      contextIsTrusted: true,
    };

    const result = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "search", query: "ceiling" },
      restrictedContext,
    );

    expect(result.isError).toBeFalsy();
    expect(memoriesFrom(result)).toHaveLength(1);
    expect(memoriesFrom(result)[0].content).toBe("personal-ceiling-visible");
  });
});
