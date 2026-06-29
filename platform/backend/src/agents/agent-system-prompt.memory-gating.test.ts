import { SYSTEM_PROMPT_VARIABLE_EXPRESSIONS } from "@archestra/shared";
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
});
