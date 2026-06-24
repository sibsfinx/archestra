CREATE TABLE "mail_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text DEFAULT 'log' NOT NULL,
	"smtp_host" text,
	"smtp_port" integer,
	"smtp_tls_mode" text DEFAULT 'none' NOT NULL,
	"smtp_username" text,
	"smtp_password" text,
	"from_address" text,
	"from_name" text,
	"reply_to" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_settings_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "mail_settings" ADD CONSTRAINT "mail_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
