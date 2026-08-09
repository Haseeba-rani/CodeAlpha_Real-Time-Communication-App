import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const profileSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  bio: z.string(),
  timezone: z.string(),
  language: z.string(),
  role: z.string(),
  updatedAt: z.coerce.date(),
});

export const profilesTable = pgTable("profiles", {
  userId: text("user_id").primaryKey(),
  name: text("name").notNull().default("Ari Mendoza"),
  email: text("email").notNull().default("ari@yourcrew.co"),
  bio: text("bio").notNull().default("Product lead"),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  language: text("language").notNull().default("English"),
  role: text("role").notNull().default("Product lead"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProfileRow = typeof profilesTable.$inferSelect;
export type NewProfile = typeof profilesTable.$inferInsert;