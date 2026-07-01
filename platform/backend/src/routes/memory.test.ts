import {
  ADMIN_ROLE_NAME,
  EDITOR_ROLE_NAME,
  MEMBER_ROLE_NAME,
} from "@archestra/shared";
import { eq } from "drizzle-orm";
import {
  DUPLICATE_CONTENT_MESSAGE,
  MAX_CORE_ITEMS_PER_SCOPE,
} from "@/archestra-mcp-server/memory";
import config from "@/config";
import db, { schema } from "@/database";
import { OrganizationModel } from "@/models";
import type { FastifyInstanceWithZod } from "@/server";
import { createFastifyInstance } from "@/server";
import { afterEach, beforeEach, describe, expect, test } from "@/test";
import type { InsertMemory, User } from "@/types";
import memoryRoutes from "./memory";

async function seedMemory(values: InsertMemory) {
  const [row] = await db
    .insert(schema.memoriesTable)
    .values(values)
    .returning();
  return row;
}

describe("GET /api/memory", () => {
  let app: FastifyInstanceWithZod;
  let organizationId: string;
  let actingUser: User;

  beforeEach(async ({ makeOrganization, makeUser }) => {
    organizationId = (await makeOrganization()).id;
    actingUser = await makeUser();

    app = createFastifyInstance();
    app.addHook("onRequest", async (request) => {
      Object.assign(request, { user: actingUser, organizationId });
    });
    await app.register(memoryRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  test("lists personal memories for the current user only", async ({
    makeMember,
    makeUser,
  }) => {
    const otherUser = await makeUser();
    await makeMember(actingUser.id, organizationId, { role: MEMBER_ROLE_NAME });
    await makeMember(otherUser.id, organizationId, { role: MEMBER_ROLE_NAME });

    await seedMemory({
      organizationId,
      visibility: "personal",
      userId: actingUser.id,
      teamId: null,
      content: "my-preference",
      tier: "core",
      createdBy: actingUser.id,
    });
    await seedMemory({
      organizationId,
      visibility: "personal",
      userId: otherUser.id,
      teamId: null,
      content: "other-preference",
      tier: "core",
      createdBy: otherUser.id,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/memory?visibility=personal",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(1);
    expect(response.json().data[0].content).toBe("my-preference");
  });

  test("team memories are visible to team members but not outsiders", async ({
    makeMember,
    makeTeam,
    makeTeamMember,
    makeUser,
  }) => {
    const owner = await makeUser();
    const member = await makeUser();
    const outsider = await makeUser();
    await makeMember(owner.id, organizationId, { role: MEMBER_ROLE_NAME });
    await makeMember(member.id, organizationId, { role: MEMBER_ROLE_NAME });
    await makeMember(outsider.id, organizationId, { role: MEMBER_ROLE_NAME });

    const team = await makeTeam(organizationId, owner.id);
    await makeTeamMember(team.id, member.id);

    await seedMemory({
      organizationId,
      visibility: "team",
      userId: null,
      teamId: team.id,
      content: "team-runbook",
      tier: "core",
      createdBy: owner.id,
    });

    actingUser = member;
    const memberResponse = await app.inject({
      method: "GET",
      url: "/api/memory?visibility=team",
    });
    expect(memberResponse.statusCode).toBe(200);
    expect(memberResponse.json().data).toHaveLength(1);

    actingUser = outsider;
    const outsiderResponse = await app.inject({
      method: "GET",
      url: "/api/memory?visibility=team",
    });
    expect(outsiderResponse.statusCode).toBe(200);
    expect(outsiderResponse.json().data).toEqual([]);
  });

  test("org memories are visible to any org member", async ({
    makeMember,
    makeUser,
  }) => {
    const owner = await makeUser();
    const orgUser = await makeUser();
    await makeMember(owner.id, organizationId, { role: MEMBER_ROLE_NAME });
    await makeMember(orgUser.id, organizationId, { role: MEMBER_ROLE_NAME });

    await seedMemory({
      organizationId,
      visibility: "org",
      userId: null,
      teamId: null,
      content: "org-policy",
      tier: "core",
      createdBy: owner.id,
    });

    actingUser = orgUser;
    const response = await app.inject({
      method: "GET",
      url: "/api/memory?visibility=org",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(1);
    expect(response.json().data[0].content).toBe("org-policy");
  });

  test("does not list memories from another organization", async ({
    makeMember,
    makeOrganization,
    makeUser,
  }) => {
    await makeMember(actingUser.id, organizationId, { role: MEMBER_ROLE_NAME });

    const otherOrg = await makeOrganization();
    const otherUser = await makeUser();
    await seedMemory({
      organizationId: otherOrg.id,
      visibility: "org",
      userId: null,
      teamId: null,
      content: "foreign-org-only",
      tier: "core",
      createdBy: otherUser.id,
    });
    await seedMemory({
      organizationId,
      visibility: "personal",
      userId: actingUser.id,
      teamId: null,
      content: "own-personal-only",
      tier: "core",
      createdBy: actingUser.id,
    });

    const personalResponse = await app.inject({
      method: "GET",
      url: "/api/memory?visibility=personal",
    });
    expect(personalResponse.statusCode).toBe(200);
    expect(personalResponse.json().data).toHaveLength(1);
    expect(personalResponse.json().data[0].content).toBe("own-personal-only");

    const orgResponse = await app.inject({
      method: "GET",
      url: "/api/memory?visibility=org",
    });
    expect(orgResponse.statusCode).toBe(200);
    expect(orgResponse.json().data).toEqual([]);
  });
});

describe("POST /api/memory", () => {
  let app: FastifyInstanceWithZod;
  let organizationId: string;
  let actingUser: User;

  beforeEach(async ({ makeOrganization, makeUser }) => {
    organizationId = (await makeOrganization()).id;
    actingUser = await makeUser();

    app = createFastifyInstance();
    app.addHook("onRequest", async (request) => {
      Object.assign(request, { user: actingUser, organizationId });
    });
    await app.register(memoryRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  test("members can create personal memories", async ({ makeMember }) => {
    await makeMember(actingUser.id, organizationId, { role: MEMBER_ROLE_NAME });

    const response = await app.inject({
      method: "POST",
      url: "/api/memory",
      payload: {
        content: "prefers concise answers",
        visibility: "personal",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().content).toBe("prefers concise answers");
    expect(response.json().visibility).toBe("personal");
  });

  test("members cannot create org-scoped memories", async ({ makeMember }) => {
    await makeMember(actingUser.id, organizationId, { role: MEMBER_ROLE_NAME });

    const response = await app.inject({
      method: "POST",
      url: "/api/memory",
      payload: {
        content: "org-only",
        visibility: "org",
      },
    });

    expect(response.statusCode).toBe(403);
  });

  test("admins can create org-scoped memories", async ({ makeMember }) => {
    await makeMember(actingUser.id, organizationId, { role: ADMIN_ROLE_NAME });

    const response = await app.inject({
      method: "POST",
      url: "/api/memory",
      payload: {
        content: "org-wide guidance",
        visibility: "org",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().visibility).toBe("org");
  });

  test("team-admins can create memories only for teams they belong to", async ({
    makeMember,
    makeTeam,
    makeTeamMember,
  }) => {
    await makeMember(actingUser.id, organizationId, { role: EDITOR_ROLE_NAME });
    const ownTeam = await makeTeam(organizationId, actingUser.id);
    await makeTeamMember(ownTeam.id, actingUser.id);
    const foreignTeam = await makeTeam(organizationId, actingUser.id);

    const ok = await app.inject({
      method: "POST",
      url: "/api/memory",
      payload: {
        content: "team guidance",
        visibility: "team",
        teamId: ownTeam.id,
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().teamId).toBe(ownTeam.id);

    const denied = await app.inject({
      method: "POST",
      url: "/api/memory",
      payload: {
        content: "foreign team guidance",
        visibility: "team",
        teamId: foreignTeam.id,
      },
    });
    expect(denied.statusCode).toBe(403);
  });

  test("duplicate create returns existing row when core capacity is full", async ({
    makeMember,
    makeTeamMember,
  }) => {
    await makeMember(actingUser.id, organizationId, { role: EDITOR_ROLE_NAME });
    const teamId = "team_better_auth_text_id";
    await db.insert(schema.teamsTable).values({
      id: teamId,
      name: "Text ID Team",
      organizationId,
      createdBy: actingUser.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await makeTeamMember(teamId, actingUser.id);

    const response = await app.inject({
      method: "POST",
      url: "/api/memory",
      payload: {
        content: "team text id memory",
        visibility: "team",
        teamId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().teamId).toBe(teamId);
  });

  test("duplicate create returns existing row when core capacity is full", async ({
    makeMember,
  }) => {
    await makeMember(actingUser.id, organizationId, { role: MEMBER_ROLE_NAME });

    for (let i = 0; i < MAX_CORE_ITEMS_PER_SCOPE; i++) {
      await seedMemory({
        organizationId,
        visibility: "personal",
        userId: actingUser.id,
        teamId: null,
        content: `route-core-slot-${i}`,
        tier: "core",
        createdBy: actingUser.id,
      });
    }

    const response = await app.inject({
      method: "POST",
      url: "/api/memory",
      payload: {
        content: "route-core-slot-0",
        visibility: "personal",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().content).toBe("route-core-slot-0");

    const rows = await db
      .select({ id: schema.memoriesTable.id })
      .from(schema.memoriesTable)
      .where(eq(schema.memoriesTable.content, "route-core-slot-0"));
    expect(rows).toHaveLength(1);
  });
});

describe("PATCH /api/memory/:id", () => {
  let app: FastifyInstanceWithZod;
  let organizationId: string;
  let actingUser: User;

  beforeEach(async ({ makeOrganization, makeUser }) => {
    organizationId = (await makeOrganization()).id;
    actingUser = await makeUser();

    app = createFastifyInstance();
    app.addHook("onRequest", async (request) => {
      Object.assign(request, { user: actingUser, organizationId });
    });
    await app.register(memoryRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  test("members cannot update another user's personal memory", async ({
    makeMember,
    makeUser,
  }) => {
    const owner = await makeUser();
    await makeMember(actingUser.id, organizationId, { role: MEMBER_ROLE_NAME });
    await makeMember(owner.id, organizationId, { role: MEMBER_ROLE_NAME });

    const memory = await seedMemory({
      organizationId,
      visibility: "personal",
      userId: owner.id,
      teamId: null,
      content: "owner-only",
      tier: "core",
      createdBy: owner.id,
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/memory/${memory?.id}`,
      payload: { content: "hijacked" },
    });

    expect(response.statusCode).toBe(403);
  });

  test("rejects update to duplicate content in the same scope", async ({
    makeMember,
  }) => {
    await makeMember(actingUser.id, organizationId, { role: MEMBER_ROLE_NAME });

    const first = await seedMemory({
      organizationId,
      visibility: "personal",
      userId: actingUser.id,
      teamId: null,
      content: "route-existing-content",
      tier: "core",
      createdBy: actingUser.id,
    });
    const second = await seedMemory({
      organizationId,
      visibility: "personal",
      userId: actingUser.id,
      teamId: null,
      content: "route-other-content",
      tier: "core",
      createdBy: actingUser.id,
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/memory/${second?.id}`,
      payload: { content: "route-existing-content" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toBe(DUPLICATE_CONTENT_MESSAGE);

    const unchanged = await db
      .select()
      .from(schema.memoriesTable)
      .where(eq(schema.memoriesTable.id, second?.id));
    expect(unchanged[0]?.content).toBe("route-other-content");
    expect(first?.id).not.toBe(second?.id);
  });

  test("cross-org memory id returns 404 on patch and delete", async ({
    makeMember,
    makeOrganization,
    makeUser,
  }) => {
    await makeMember(actingUser.id, organizationId, { role: MEMBER_ROLE_NAME });

    const otherOrg = await makeOrganization();
    const otherUser = await makeUser();
    const foreign = await seedMemory({
      organizationId: otherOrg.id,
      visibility: "personal",
      userId: otherUser.id,
      teamId: null,
      content: "foreign-org-memory",
      tier: "core",
      createdBy: otherUser.id,
    });

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/api/memory/${foreign?.id}`,
      payload: { content: "should-not-apply" },
    });
    expect(patchResponse.statusCode).toBe(404);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/memory/${foreign?.id}`,
    });
    expect(deleteResponse.statusCode).toBe(404);

    const unchanged = await db
      .select()
      .from(schema.memoriesTable)
      .where(eq(schema.memoriesTable.id, foreign?.id));
    expect(unchanged[0]?.content).toBe("foreign-org-memory");
  });

  test("team outsider cannot patch foreign team memory", async ({
    makeMember,
    makeTeam,
    makeTeamMember,
    makeUser,
  }) => {
    const teamAdmin = await makeUser();
    const teamAdminOutsider = await makeUser();
    await makeMember(teamAdmin.id, organizationId, { role: EDITOR_ROLE_NAME });
    await makeMember(teamAdminOutsider.id, organizationId, {
      role: EDITOR_ROLE_NAME,
    });

    const team = await makeTeam(organizationId, teamAdmin.id);
    await makeTeamMember(team.id, teamAdmin.id);

    const memory = await seedMemory({
      organizationId,
      visibility: "team",
      userId: null,
      teamId: team.id,
      content: "protected-team-memory",
      tier: "core",
      createdBy: teamAdmin.id,
    });

    actingUser = teamAdminOutsider;
    const response = await app.inject({
      method: "PATCH",
      url: `/api/memory/${memory?.id}`,
      payload: { content: "outsider-edit" },
    });

    expect(response.statusCode).toBe(403);

    const unchanged = await db
      .select()
      .from(schema.memoriesTable)
      .where(eq(schema.memoriesTable.id, memory?.id));
    expect(unchanged[0]?.content).toBe("protected-team-memory");
  });
});

describe("DELETE /api/memory/:id", () => {
  let app: FastifyInstanceWithZod;
  let organizationId: string;
  let actingUser: User;

  beforeEach(async ({ makeOrganization, makeUser }) => {
    organizationId = (await makeOrganization()).id;
    actingUser = await makeUser();

    app = createFastifyInstance();
    app.addHook("onRequest", async (request) => {
      Object.assign(request, { user: actingUser, organizationId });
    });
    await app.register(memoryRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  test("members cannot delete org-scoped memories", async ({ makeMember }) => {
    await makeMember(actingUser.id, organizationId, { role: MEMBER_ROLE_NAME });

    const memory = await seedMemory({
      organizationId,
      visibility: "org",
      userId: null,
      teamId: null,
      content: "protected-org-memory",
      tier: "core",
      createdBy: actingUser.id,
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/memory/${memory?.id}`,
    });

    expect(response.statusCode).toBe(403);
  });

  test("team outsider cannot delete foreign team memory", async ({
    makeMember,
    makeTeam,
    makeTeamMember,
    makeUser,
  }) => {
    const teamAdmin = await makeUser();
    const teamAdminOutsider = await makeUser();
    await makeMember(teamAdmin.id, organizationId, { role: EDITOR_ROLE_NAME });
    await makeMember(teamAdminOutsider.id, organizationId, {
      role: EDITOR_ROLE_NAME,
    });

    const team = await makeTeam(organizationId, teamAdmin.id);
    await makeTeamMember(team.id, teamAdmin.id);

    const memory = await seedMemory({
      organizationId,
      visibility: "team",
      userId: null,
      teamId: team.id,
      content: "protected-team-delete-target",
      tier: "core",
      createdBy: teamAdmin.id,
    });

    actingUser = teamAdminOutsider;
    const response = await app.inject({
      method: "DELETE",
      url: `/api/memory/${memory?.id}`,
    });

    expect(response.statusCode).toBe(403);

    const stillThere = await db
      .select()
      .from(schema.memoriesTable)
      .where(eq(schema.memoriesTable.id, memory?.id));
    expect(stillThere).toHaveLength(1);
  });
});

describe("memory feature gates", () => {
  let app: FastifyInstanceWithZod;
  let organizationId: string;
  let actingUser: User;
  const originalMemoryEnabled = config.memory.enabled;

  beforeEach(async ({ makeOrganization, makeUser }) => {
    organizationId = (await makeOrganization()).id;
    actingUser = await makeUser();

    app = createFastifyInstance();
    app.addHook("onRequest", async (request) => {
      Object.assign(request, { user: actingUser, organizationId });
    });
    await app.register(memoryRoutes);
  });

  afterEach(async () => {
    (config.memory as { enabled: boolean }).enabled = originalMemoryEnabled;
    await app.close();
  });

  test("returns 404 when durable memory is globally disabled", async () => {
    (config.memory as { enabled: boolean }).enabled = false;

    const response = await app.inject({
      method: "GET",
      url: "/api/memory?visibility=personal",
    });

    expect(response.statusCode).toBe(404);
  });

  test("returns 403 when org durable memory is disabled", async () => {
    await OrganizationModel.patch(organizationId, { memoryEnabled: false });

    const response = await app.inject({
      method: "GET",
      url: "/api/memory?visibility=personal",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toContain("disabled");
  });
});
