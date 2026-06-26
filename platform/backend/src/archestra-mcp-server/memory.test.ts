// biome-ignore-all lint/suspicious/noExplicitAny: test
import {
  ARCHESTRA_MCP_SERVER_NAME,
  MCP_SERVER_TOOL_NAME_SEPARATOR,
  TOOL_MEMORY_SHORT_NAME,
} from "@archestra/shared";
import { count, eq } from "drizzle-orm";
import db, { schema } from "@/database";
import type { InsertMemory } from "@/types";
import { beforeEach, describe, expect, test } from "@/test";
import type { Agent } from "@/types";
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
  const [row] = await db.insert(schema.memoriesTable).values(values).returning();
  return row;
}

describe("memory tool execution", () => {
  let agent: Agent;
  let organizationId: string;
  let userId: string;
  let otherUserId: string;
  let context: ArchestraContext;

  beforeEach(
    async ({ makeAgent, makeUser, makeMember, makeOrganization }) => {
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
    },
  );

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
      agent: { id: agent.id, name: agent.name },
      organizationId,
      userId: member.id,
      contextIsTrusted: true,
    };
    const outsiderContext: ArchestraContext = {
      agent: { id: agent.id, name: agent.name },
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

  test("org memory is visible to any org user", async ({ makeUser, makeMember }) => {
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

  test("duplicate create results in exactly one row", async () => {
    const args = { command: "create" as const, content: "duplicate-me" };

    const first = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      args,
      context,
    );
    const second = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      args,
      context,
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

  test("update to duplicate content returns controlled error", async () => {
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

    const result = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "update", id: second.id, content: "existing-content" },
      context,
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

  test("view by id does not expose team or org memories", async ({
    makeTeam,
    makeTeamMember,
  }) => {
    const team = await makeTeam(organizationId, userId);
    await makeTeamMember(team.id, userId);

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
      content: "org-view-by-id-hidden",
      tier: "core",
      createdBy: userId,
    });

    const teamView = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "view", id: teamMemory.id },
      context,
    );
    const orgView = await executeArchestraTool(
      t(TOOL_MEMORY_SHORT_NAME),
      { command: "view", id: orgMemory.id },
      context,
    );

    expect(teamView.isError).toBeFalsy();
    expect(orgView.isError).toBeFalsy();
    expect(memoriesFrom(teamView)).toEqual([]);
    expect(memoriesFrom(orgView)).toEqual([]);
    expect(textOf(teamView)).toContain("No matching memory found");
    expect(textOf(orgView)).toContain("No matching memory found");
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
});
