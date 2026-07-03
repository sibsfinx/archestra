import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  MemorySourceKind,
  MemoryTier,
  MemoryVisibility,
} from "@/types/memory";
import agentsTable from "./agent";
import organizationsTable from "./organization";
import { team } from "./team";
import usersTable from "./user";

const memoriesTable = pgTable(
  "memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    tier: text("tier").$type<MemoryTier>().notNull().default("core"),
    visibility: text("visibility")
      .$type<MemoryVisibility>()
      .notNull()
      .default("personal"),
    userId: text("user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
    teamId: text("team_id").references(() => team.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => usersTable.id),
    writtenByAgentId: uuid("written_by_agent_id").references(
      () => agentsTable.id,
      { onDelete: "set null" },
    ),
    sourceKind: text("source_kind")
      .$type<MemorySourceKind>()
      .notNull()
      .default("manual"),
    taintedAtWrite: boolean("tainted_at_write").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("memory_core_inject_idx").on(
      t.organizationId,
      t.visibility,
      t.userId,
    ),
    index("memory_team_idx").on(t.organizationId, t.teamId),
    uniqueIndex("memory_personal_dedupe_uq")
      .on(t.organizationId, t.userId, t.content)
      .where(sql`${t.visibility} = 'personal'`),
    uniqueIndex("memory_team_dedupe_uq")
      .on(t.organizationId, t.teamId, t.content)
      .where(sql`${t.visibility} = 'team'`),
    uniqueIndex("memory_org_dedupe_uq")
      .on(t.organizationId, t.content)
      .where(sql`${t.visibility} = 'org'`),
    check(
      "memory_scope_valid",
      sql`(visibility = 'personal' AND user_id IS NOT NULL AND team_id IS NULL) OR (visibility = 'team' AND team_id IS NOT NULL AND user_id IS NULL) OR (visibility = 'org' AND user_id IS NULL AND team_id IS NULL)`,
    ),
  ],
);

export default memoriesTable;
