-- drizzle-migration-linter: allow-breaking
-- drizzle-migration-linter: reason=All flagged constraints and unique indexes target the memory table created empty in this same migration, so validation scans no existing rows and the add-validating-constraint / add-unique-constraint rules do not apply. Indexes are on a brand-new empty table so CONCURRENTLY is unnecessary. ON DELETE cascade on org/user/team FKs is intentional (memory rows are scoped to their parent).
CREATE TABLE "memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"tier" text DEFAULT 'core' NOT NULL,
	"visibility" text DEFAULT 'personal' NOT NULL,
	"user_id" text,
	"team_id" text,
	"content" text NOT NULL,
	"created_by" text NOT NULL,
	"tainted_at_write" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_scope_valid" CHECK ((visibility = 'personal' AND user_id IS NOT NULL AND team_id IS NULL) OR (visibility = 'team' AND team_id IS NOT NULL AND user_id IS NULL) OR (visibility = 'org' AND user_id IS NULL AND team_id IS NULL))
);
--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_core_inject_idx" ON "memory" USING btree ("organization_id","visibility","user_id");--> statement-breakpoint
CREATE INDEX "memory_team_idx" ON "memory" USING btree ("organization_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_personal_dedupe_uq" ON "memory" USING btree ("organization_id","user_id","content") WHERE "memory"."visibility" = 'personal';--> statement-breakpoint
CREATE UNIQUE INDEX "memory_team_dedupe_uq" ON "memory" USING btree ("organization_id","team_id","content") WHERE "memory"."visibility" = 'team';--> statement-breakpoint
CREATE UNIQUE INDEX "memory_org_dedupe_uq" ON "memory" USING btree ("organization_id","content") WHERE "memory"."visibility" = 'org';