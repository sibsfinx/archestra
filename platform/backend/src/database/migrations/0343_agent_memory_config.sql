ALTER TABLE "agents" ADD COLUMN "memory_target_mode" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "shared_memory_write_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "written_by_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "source_kind" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_written_by_agent_id_agents_id_fk" FOREIGN KEY ("written_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action NOT VALID;
