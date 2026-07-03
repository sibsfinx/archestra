import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-zod";
import { z } from "zod";
import { schema } from "@/database";
import { MemoryVisibilitySchema } from "./memory";

export const MemoryAccessLevelSchema = z.enum([
  "personal",
  "team",
  "organization",
]);
export type MemoryAccessLevel = z.infer<typeof MemoryAccessLevelSchema>;

export const MemberSchema = createSelectSchema(schema.membersTable, {
  memoryAccessLevel: MemoryAccessLevelSchema,
});

export const MemberListItemSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().nullable(),
  email: z.string(),
  image: z.string().nullable(),
  role: z.string(),
  createdAt: z.date(),
  memoryAccessLevel: MemoryAccessLevelSchema,
});

export const UpdateMemberMemoryAccessBodySchema = z.object({
  accessLevel: MemoryAccessLevelSchema,
});

const UpdateMemberSchema = createUpdateSchema(schema.membersTable);
const InsertMemberSchema = createInsertSchema(schema.membersTable);

export type Member = z.infer<typeof MemberSchema>;
export type MemberListItem = z.infer<typeof MemberListItemSchema>;
export type UpdateMember = z.infer<typeof UpdateMemberSchema>;
export type InsertMember = z.infer<typeof InsertMemberSchema>;
