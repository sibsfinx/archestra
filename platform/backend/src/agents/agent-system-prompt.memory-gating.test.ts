import { SYSTEM_PROMPT_VARIABLE_EXPRESSIONS } from "@archestra/shared";
import { eq } from "drizzle-orm";
import db, { schema } from "@/database";
import MemoryModel from "@/models/memory";
import OrganizationModel from "@/models/organization";
import { describe, expect, test, vi } from "@/test";
import { buildAgentSystemPrompt } from "./agent-system-prompt";

describe("buildAgentSystemPrompt memory gating", () => {
  test("skips memory injection when org durable memory is disabled", async ({
    makeAgent,
    makeUser,
    makeMember,
  }) => {
    const listCoreForInjectionSpy = vi.spyOn(
      MemoryModel,
      "listCoreForInjection",
    );

    const agent = await makeAgent({
      systemPrompt:
        `Facts ${SYSTEM_PROMPT_VARIABLE_EXPRESSIONS.memories}: ` +
        "{{#each memories}}{{content}};{{/each}}",
      toolExposureMode: "full",
    });
    const actingUser = await makeUser();
    await makeMember(actingUser.id, agent.organizationId);
    await OrganizationModel.patch(agent.organizationId, {
      memoryEnabled: false,
    });

    await db.insert(schema.memoriesTable).values({
      organizationId: agent.organizationId,
      visibility: "personal",
      userId: actingUser.id,
      teamId: null,
      content: "should-not-inject",
      tier: "core",
      createdBy: actingUser.id,
    });

    const prompt = await buildAgentSystemPrompt({
      agent,
      mcpTools: {},
      organizationId: agent.organizationId,
      userId: actingUser.id,
      agentId: agent.id,
    });

    expect(prompt).not.toContain("should-not-inject");
    expect(listCoreForInjectionSpy).not.toHaveBeenCalled();
    listCoreForInjectionSpy.mockRestore();
  });

  test("injects only personal memories when member access level is personal", async ({
    makeAgent,
    makeUser,
    makeMember,
    makeTeam,
    makeTeamMember,
  }) => {
    const agent = await makeAgent({
      systemPrompt:
        `Facts ${SYSTEM_PROMPT_VARIABLE_EXPRESSIONS.memories}: ` +
        "{{#each memories}}{{content}};{{/each}}",
      toolExposureMode: "full",
    });
    const actingUser = await makeUser();
    const memberRow = await makeMember(actingUser.id, agent.organizationId);
    await db
      .update(schema.membersTable)
      .set({ memoryAccessLevel: "personal" })
      .where(eq(schema.membersTable.id, memberRow.id));

    const team = await makeTeam(agent.organizationId, actingUser.id);
    await makeTeamMember(team.id, actingUser.id);

    await db.insert(schema.memoriesTable).values([
      {
        organizationId: agent.organizationId,
        visibility: "personal",
        userId: actingUser.id,
        teamId: null,
        content: "personal-fact",
        tier: "core",
        createdBy: actingUser.id,
      },
      {
        organizationId: agent.organizationId,
        visibility: "org",
        userId: null,
        teamId: null,
        content: "org-fact",
        tier: "core",
        createdBy: actingUser.id,
      },
      {
        organizationId: agent.organizationId,
        visibility: "team",
        userId: null,
        teamId: team.id,
        content: "team-fact",
        tier: "core",
        createdBy: actingUser.id,
      },
    ]);

    const prompt = await buildAgentSystemPrompt({
      agent,
      mcpTools: {},
      organizationId: agent.organizationId,
      userId: actingUser.id,
      agentId: agent.id,
    });

    expect(prompt).toContain("personal-fact");
    expect(prompt).not.toContain("org-fact");
    expect(prompt).not.toContain("team-fact");
  });

  test("org-targeted agent injects org memory when access level allows it", async ({
    makeAgent,
    makeUser,
    makeMember,
  }) => {
    const agent = await makeAgent({
      scope: "org",
      systemPrompt:
        `Facts ${SYSTEM_PROMPT_VARIABLE_EXPRESSIONS.memories}: ` +
        "{{#each memories}}{{content}};{{/each}}",
      toolExposureMode: "full",
    });
    const actingUser = await makeUser();
    await makeMember(actingUser.id, agent.organizationId);

    await db.insert(schema.memoriesTable).values([
      {
        organizationId: agent.organizationId,
        visibility: "personal",
        userId: actingUser.id,
        teamId: null,
        content: "personal-fact",
        tier: "core",
        createdBy: actingUser.id,
      },
      {
        organizationId: agent.organizationId,
        visibility: "org",
        userId: null,
        teamId: null,
        content: "org-fact",
        tier: "core",
        createdBy: actingUser.id,
      },
    ]);

    const prompt = await buildAgentSystemPrompt({
      agent,
      mcpTools: {},
      organizationId: agent.organizationId,
      userId: actingUser.id,
      agentId: agent.id,
    });

    expect(prompt).toContain("personal-fact");
    expect(prompt).toContain("org-fact");
  });

  test("personal-target agent does not inject org memory when access level is organization", async ({
    makeAgent,
    makeUser,
    makeMember,
  }) => {
    const actingUser = await makeUser();
    const agent = await makeAgent({
      scope: "personal",
      authorId: actingUser.id,
      systemPrompt:
        `Facts ${SYSTEM_PROMPT_VARIABLE_EXPRESSIONS.memories}: ` +
        "{{#each memories}}{{content}};{{/each}}",
      toolExposureMode: "full",
    });
    const memberRow = await makeMember(actingUser.id, agent.organizationId);
    await db
      .update(schema.membersTable)
      .set({ memoryAccessLevel: "organization" })
      .where(eq(schema.membersTable.id, memberRow.id));

    await db.insert(schema.memoriesTable).values([
      {
        organizationId: agent.organizationId,
        visibility: "personal",
        userId: actingUser.id,
        teamId: null,
        content: "personal-target-personal-fact",
        tier: "core",
        createdBy: actingUser.id,
      },
      {
        organizationId: agent.organizationId,
        visibility: "org",
        userId: null,
        teamId: null,
        content: "personal-target-org-fact",
        tier: "core",
        createdBy: actingUser.id,
      },
    ]);

    const prompt = await buildAgentSystemPrompt({
      agent,
      mcpTools: {},
      organizationId: agent.organizationId,
      userId: actingUser.id,
      agentId: agent.id,
    });

    expect(prompt).toContain("personal-target-personal-fact");
    expect(prompt).not.toContain("personal-target-org-fact");
  });
});
