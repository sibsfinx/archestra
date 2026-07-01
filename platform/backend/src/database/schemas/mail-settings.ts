import { integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import organizationsTable from "./organization";

const mailSettingsTable = pgTable(
  "mail_settings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("log"),
    smtpHost: text("smtp_host"),
    smtpPort: integer("smtp_port"),
    smtpTlsMode: text("smtp_tls_mode").notNull().default("none"),
    smtpUsername: text("smtp_username"),
    smtpPassword: text("smtp_password"),
    fromAddress: text("from_address"),
    fromName: text("from_name"),
    replyTo: text("reply_to"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.organizationId)],
);

export default mailSettingsTable;
