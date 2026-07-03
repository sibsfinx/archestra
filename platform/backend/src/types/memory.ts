import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-zod";
import { z } from "zod";
import { schema } from "@/database";
import { ResourceVisibilityScopeSchema } from "./visibility";

export const MemoryTierSchema = z.enum(["core", "archival"]);
export type MemoryTier = z.infer<typeof MemoryTierSchema>;

export const MemoryVisibilitySchema = ResourceVisibilityScopeSchema;
export type MemoryVisibility = z.infer<typeof MemoryVisibilitySchema>;

export const MemorySourceKindSchema = z.enum(["manual", "agent"]);
export type MemorySourceKind = z.infer<typeof MemorySourceKindSchema>;

export const SelectMemorySchema = createSelectSchema(schema.memoriesTable, {
  tier: MemoryTierSchema,
  visibility: MemoryVisibilitySchema,
  sourceKind: MemorySourceKindSchema,
});

export const MemoryListItemSchema = SelectMemorySchema.extend({
  createdByName: z.string().optional(),
});

export const InsertMemorySchema = createInsertSchema(schema.memoriesTable, {
  tier: MemoryTierSchema.optional(),
  visibility: MemoryVisibilitySchema.optional(),
  sourceKind: MemorySourceKindSchema.optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const UpdateMemorySchema = createUpdateSchema(schema.memoriesTable, {
  tier: MemoryTierSchema.optional(),
  visibility: MemoryVisibilitySchema.optional(),
  content: z.string().optional(),
  taintedAtWrite: z.boolean().optional(),
}).omit({
  id: true,
  organizationId: true,
  userId: true,
  teamId: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

export type Memory = z.infer<typeof SelectMemorySchema>;
export type InsertMemory = z.infer<typeof InsertMemorySchema>;
export type UpdateMemory = z.infer<typeof UpdateMemorySchema>;
