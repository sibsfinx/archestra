import { vi } from "vitest";

vi.mock("@/logging", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

import {
  ADMIN_ROLE_NAME,
  SYSTEM_PROMPT_VARIABLE_EXPRESSIONS,
  TOOL_LOAD_SKILL_SHORT_NAME,
} from "@archestra/shared";
import type { Tool } from "ai";
import { archestraMcpBranding } from "@/archestra-mcp-server";
import db, { schema } from "@/database";
import logger from "@/logging";
import { MemoryModel, SkillModel } from "@/models";
import { SKILL_SANDBOX_ATTACHMENTS_DIR } from "@/skills-sandbox/runtime-image";
import { beforeEach, describe, expect, test } from "@/test";
import type { InsertMemory } from "@/types";
import {
  buildAgentSystemPrompt,
  PROJECT_INSTRUCTIONS_PREFIX,
  TOOL_DENIAL_INSTRUCTION,
  TOOL_UI_RESULT_INSTRUCTION,
} from "./agent-system-prompt";

const loadSkillToolName = archestraMcpBranding.getToolName(
  TOOL_LOAD_SKILL_SHORT_NAME,
);
const someTool: Record<string, Tool> = { some_tool: {} as Tool };
const withLoadSkill: Record<string, Tool> = { [loadSkillToolName]: {} as Tool };

async function seedSkill(organizationId: string) {
  return await SkillModel.createWithFiles({
    skill: {
      organizationId,
      name: "pdf-processing",
      description: "Extract text from PDF files.",
      content: "# PDF Processing\nUse pdftotext.",
      metadata: {},
      sourceType: "manual",
      scope: "org",
    },
    files: [],
  });
}

describe("buildAgentSystemPrompt", () => {
  beforeEach(() => {
    vi.mocked(logger.info).mockClear();
  });

  test("passes the base prompt through and always appends the denial instruction", async ({
    makeAgent,
    makeUser,
    makeMember,
  }) => {
    const agent = await makeAgent({
      systemPrompt: "You are helpful.",
      toolExposureMode: "full",
    });
    const user = await makeUser();
    await makeMember(user.id, agent.organizationId);

    const prompt = await buildAgentSystemPrompt({
      agent,
      mcpTools: {},
      organizationId: agent.organizationId,
      userId: user.id,
      agentId: agent.id,
    });

    expect(prompt).toBe(`You are helpful.\n\n${TOOL_DENIAL_INSTRUCTION}`);
  });

  test("does not query memories when the prompt omits {{memories}}", async ({
    makeAgent,
    makeUser,
    makeMember,
  }) => {
    const listCoreForInjectionSpy = vi.spyOn(
      MemoryModel,
      "listCoreForInjection",
    );

    const agent = await makeAgent({
      systemPrompt: "Hi {{user.name}}.",
      toolExposureMode: "full",
    });
    const user = await makeUser();
    await makeMember(user.id, agent.organizationId);

    await buildAgentSystemPrompt({
      agent,
      mcpTools: {},
      organizationId: agent.organizationId,
      userId: user.id,
      agentId: agent.id,
    });

    expect(listCoreForInjectionSpy).not.toHaveBeenCalled();
    expect(vi.mocked(logger.info)).not.toHaveBeenCalledWith(
      expect.anything(),
      "[Memory] Core memories loaded for prompt injection",
    );
    listCoreForInjectionSpy.mockRestore();
  });

  test("injects only readable core memories and excludes foreign scopes and archival", async ({
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
    const otherUser = await makeUser();
    await makeMember(actingUser.id, agent.organizationId);
    await makeMember(otherUser.id, agent.organizationId);

    const memberTeam = await makeTeam(agent.organizationId, actingUser.id, {
      name: "Member Team",
    });
    const foreignTeam = await makeTeam(agent.organizationId, otherUser.id, {
      name: "Foreign Team",
    });
    await makeTeamMember(memberTeam.id, actingUser.id);

    const seed = async (values: InsertMemory) => {
      await db.insert(schema.memoriesTable).values(values);
    };

    await seed({
      organizationId: agent.organizationId,
      visibility: "personal",
      userId: actingUser.id,
      teamId: null,
      content: "own-personal-core",
      tier: "core",
      createdBy: actingUser.id,
    });
    await seed({
      organizationId: agent.organizationId,
      visibility: "personal",
      userId: actingUser.id,
      teamId: null,
      content: "own-personal-archival",
      tier: "archival",
      createdBy: actingUser.id,
    });
    await seed({
      organizationId: agent.organizationId,
      visibility: "personal",
      userId: otherUser.id,
      teamId: null,
      content: "foreign-personal-core",
      tier: "core",
      createdBy: otherUser.id,
    });
    await seed({
      organizationId: agent.organizationId,
      visibility: "team",
      userId: null,
      teamId: memberTeam.id,
      content: "member-team-core",
      tier: "core",
      createdBy: actingUser.id,
    });
    await seed({
      organizationId: agent.organizationId,
      visibility: "team",
      userId: null,
      teamId: foreignTeam.id,
      content: "foreign-team-core",
      tier: "core",
      createdBy: otherUser.id,
    });
    await seed({
      organizationId: agent.organizationId,
      visibility: "org",
      userId: null,
      teamId: null,
      content: "org-core-fact",
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

    expect(prompt).toContain("own-personal-core;");
    expect(prompt).toContain("member-team-core;");
    expect(prompt).toContain("org-core-fact;");
    expect(prompt).not.toContain("own-personal-archival");
    expect(prompt).not.toContain("foreign-personal-core");
    expect(prompt).not.toContain("foreign-team-core");

    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: agent.organizationId,
        userId: actingUser.id,
        memoryCount: 3,
        memoryIds: expect.arrayContaining([
          expect.any(String),
          expect.any(String),
          expect.any(String),
        ]),
      }),
      "[Memory] Core memories loaded for prompt injection",
    );
  });

  test("renders Handlebars user context from a fetched user and their teams", async ({
    makeAgent,
    makeUser,
    makeMember,
    makeTeam,
    makeTeamMember,
  }) => {
    const agent = await makeAgent({
      systemPrompt: "Hi {{user.name}} <{{user.email}}>. Teams: {{user.teams}}.",
      toolExposureMode: "full",
    });
    const user = await makeUser({ email: "alice@test.com" });
    await makeMember(user.id, agent.organizationId);
    const team = await makeTeam(agent.organizationId, user.id, {
      name: "Platform",
    });
    await makeTeamMember(team.id, user.id);

    const prompt = await buildAgentSystemPrompt({
      agent,
      mcpTools: {},
      organizationId: agent.organizationId,
      userId: user.id,
      agentId: agent.id,
    });

    expect(prompt).toContain("<alice@test.com>.");
    expect(prompt).toContain("Teams: Platform.");
  });

  test("includes the skill catalog only when the load-skill tool is present", async ({
    makeAgent,
    makeUser,
    makeMember,
  }) => {
    const agent = await makeAgent({
      systemPrompt: "Base.",
      toolExposureMode: "full",
    });
    const user = await makeUser();
    await makeMember(user.id, agent.organizationId, { role: ADMIN_ROLE_NAME });
    await seedSkill(agent.organizationId);

    const withCatalog = await buildAgentSystemPrompt({
      agent,
      mcpTools: withLoadSkill,
      organizationId: agent.organizationId,
      userId: user.id,
      agentId: agent.id,
    });
    expect(withCatalog).toContain("<available_skills>");
    expect(withCatalog).toContain("pdf-processing");

    const withoutCatalog = await buildAgentSystemPrompt({
      agent,
      mcpTools: someTool,
      organizationId: agent.organizationId,
      userId: user.id,
      agentId: agent.id,
    });
    expect(withoutCatalog).not.toContain("<available_skills>");
  });

  test("adds the sandbox fallback instruction only when the sandbox is usable", async ({
    makeAgent,
    makeUser,
    makeMember,
    makeCustomRole,
    seedAndAssignArchestraTools,
  }) => {
    const config = (await import("@/config")).default;
    const originalEnabled = config.skillsSandbox.enabled;
    (config.skillsSandbox as { enabled: boolean }).enabled = true;

    try {
      const agent = await makeAgent({
        systemPrompt: "Base.",
        toolExposureMode: "full",
      });
      const user = await makeUser();
      const role = await makeCustomRole(agent.organizationId, {
        permission: { sandbox: ["execute"] },
      });
      await makeMember(user.id, agent.organizationId, { role: role.role });
      await seedAndAssignArchestraTools(agent.id);

      const withSandbox = await buildAgentSystemPrompt({
        agent,
        mcpTools: {},
        organizationId: agent.organizationId,
        userId: user.id,
        agentId: agent.id,
      });
      expect(withSandbox).toContain("code execution environment");
      // attachment staging guidance rides on the same sandbox-available gate
      expect(withSandbox).toContain(SKILL_SANDBOX_ATTACHMENTS_DIR);

      // the same agent gets no instruction once the sandbox is disabled on the
      // deployment, even with the tools assigned and the permission granted
      (config.skillsSandbox as { enabled: boolean }).enabled = false;
      const withoutSandbox = await buildAgentSystemPrompt({
        agent,
        mcpTools: {},
        organizationId: agent.organizationId,
        userId: user.id,
        agentId: agent.id,
      });
      expect(withoutSandbox).not.toContain("code execution environment");
      expect(withoutSandbox).not.toContain(SKILL_SANDBOX_ATTACHMENTS_DIR);
    } finally {
      (config.skillsSandbox as { enabled: boolean }).enabled = originalEnabled;
    }
  });

  test("adds the tool-result instruction only when tools are present", async ({
    makeAgent,
    makeUser,
    makeMember,
  }) => {
    const agent = await makeAgent({
      systemPrompt: "Base.",
      toolExposureMode: "full",
    });
    const user = await makeUser();
    await makeMember(user.id, agent.organizationId);
    const common = {
      agent,
      organizationId: agent.organizationId,
      userId: user.id,
      agentId: agent.id,
    };

    expect(
      await buildAgentSystemPrompt({ ...common, mcpTools: someTool }),
    ).toContain(TOOL_UI_RESULT_INSTRUCTION);
    expect(
      await buildAgentSystemPrompt({ ...common, mcpTools: {} }),
    ).not.toContain(TOOL_UI_RESULT_INSTRUCTION);
  });

  test("adds the tool-loading instruction only in search_and_run_only mode", async ({
    makeAgent,
    makeUser,
    makeMember,
  }) => {
    const user = await makeUser();
    const searchAgent = await makeAgent({
      systemPrompt: "Base.",
      toolExposureMode: "search_and_run_only",
    });
    await makeMember(user.id, searchAgent.organizationId);

    const searchPrompt = await buildAgentSystemPrompt({
      agent: searchAgent,
      mcpTools: {},
      organizationId: searchAgent.organizationId,
      userId: user.id,
      agentId: searchAgent.id,
    });
    expect(searchPrompt).toContain("must be discovered");

    const fullAgent = await makeAgent({
      systemPrompt: "Base.",
      toolExposureMode: "full",
      organizationId: searchAgent.organizationId,
    });
    const fullPrompt = await buildAgentSystemPrompt({
      agent: fullAgent,
      mcpTools: {},
      organizationId: fullAgent.organizationId,
      userId: user.id,
      agentId: fullAgent.id,
    });
    expect(fullPrompt).not.toContain("must be discovered");
  });

  test("appends the hook session context last", async ({
    makeAgent,
    makeUser,
    makeMember,
  }) => {
    const agent = await makeAgent({
      systemPrompt: "Base.",
      toolExposureMode: "full",
    });
    const user = await makeUser();
    await makeMember(user.id, agent.organizationId);

    const prompt = await buildAgentSystemPrompt({
      agent,
      mcpTools: {},
      organizationId: agent.organizationId,
      userId: user.id,
      agentId: agent.id,
      hookSessionContext: "SESSION-CONTEXT-MARKER",
    });

    expect(prompt?.endsWith("SESSION-CONTEXT-MARKER")).toBe(true);
  });

  test("injects project instructions right after the agent's own prompt", async ({
    makeAgent,
    makeUser,
    makeMember,
  }) => {
    const agent = await makeAgent({
      systemPrompt: "You are helpful.",
      toolExposureMode: "full",
    });
    const user = await makeUser();
    await makeMember(user.id, agent.organizationId);

    const prompt = await buildAgentSystemPrompt({
      agent,
      mcpTools: {},
      organizationId: agent.organizationId,
      userId: user.id,
      agentId: agent.id,
      projectInstructions: "PROJECT-RULES-MARKER",
    });

    // Present, framed by the canonical prefix, and positioned after the agent
    // prompt but before the denial instruction.
    expect(prompt).toContain(PROJECT_INSTRUCTIONS_PREFIX);
    expect(prompt).toContain("PROJECT-RULES-MARKER");
    expect(prompt).toBe(
      `You are helpful.\n\n${PROJECT_INSTRUCTIONS_PREFIX}\n\nPROJECT-RULES-MARKER\n\n${TOOL_DENIAL_INSTRUCTION}`,
    );
  });

  test("omits the project instructions section when none are given", async ({
    makeAgent,
    makeUser,
    makeMember,
  }) => {
    const agent = await makeAgent({
      systemPrompt: "You are helpful.",
      toolExposureMode: "full",
    });
    const user = await makeUser();
    await makeMember(user.id, agent.organizationId);

    const prompt = await buildAgentSystemPrompt({
      agent,
      mcpTools: {},
      organizationId: agent.organizationId,
      userId: user.id,
      agentId: agent.id,
    });

    expect(prompt).not.toContain(PROJECT_INSTRUCTIONS_PREFIX);
  });

  test("returns the denial instruction alone for an agent with no base prompt or tools", async ({
    makeAgent,
    makeUser,
    makeMember,
  }) => {
    const agent = await makeAgent({
      systemPrompt: null,
      toolExposureMode: "full",
    });
    const user = await makeUser();
    await makeMember(user.id, agent.organizationId);

    const prompt = await buildAgentSystemPrompt({
      agent,
      mcpTools: {},
      organizationId: agent.organizationId,
      userId: user.id,
      agentId: agent.id,
    });

    expect(prompt).toBe(TOOL_DENIAL_INSTRUCTION);
  });
});
