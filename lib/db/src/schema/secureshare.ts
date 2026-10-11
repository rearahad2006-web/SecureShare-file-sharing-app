import {
  boolean,
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const secureShareAdminsTable = pgTable(
  "secureshare_admins",
  {
    id: integer("id").primaryKey().default(1),
    userId: text("user_id").notNull().unique(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [check("secureshare_admins_singleton", sql`${table.id} = 1`)],
);

export const secureShareFilesTable = pgTable("secureshare_files", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    objectPath: text("object_path").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
});

export const secureShareLinksTable = pgTable("secureshare_links", {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    token: text("token").notNull().unique(),
    active: boolean("active").notNull().default(true),
    allowSubmissions: boolean("allow_submissions").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    accessCount: integer("access_count").notNull().default(0),
    lastAccessAt: timestamp("last_access_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
});

export const secureShareLinkFilesTable = pgTable(
  "secureshare_link_files",
  {
    linkId: uuid("link_id")
      .notNull()
      .references(() => secureShareLinksTable.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => secureShareFilesTable.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.linkId, table.fileId] })],
);

// These audit records deliberately retain their title snapshots after an
// administrator deletes or renames a file or link.
export const secureShareActivityTable = pgTable("secureshare_activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  linkId: uuid("link_id").notNull(),
  fileId: uuid("file_id").notNull(),
  linkTitle: text("link_title").notNull(),
  fileName: text("file_name").notNull(),
  accessedAt: timestamp("accessed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const secureShareSubmissionsTable = pgTable("secureshare_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  linkId: uuid("link_id")
    .notNull()
    .references(() => secureShareLinksTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  objectPath: text("object_path").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
