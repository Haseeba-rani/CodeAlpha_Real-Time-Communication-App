import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const participantSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  joinedAt: z.coerce.date(),
  isMuted: z.boolean(),
  cameraOn: z.boolean(),
});

export const transcriptEntrySchema = z.object({
  id: z.string(),
  speaker: z.string(),
  text: z.string(),
  createdAt: z.coerce.date(),
});

export const meetingNotesSchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  decisions: z.array(z.string()),
  actionItems: z.array(z.string()),
  followUps: z.array(z.string()),
  generatedAt: z.coerce.date(),
});

export const meetingsTable = pgTable("meetings", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  hostId: text("host_id").notNull(),
  hostName: text("host_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  status: text("status").notNull().default("live"),
  participants: jsonb("participants").$type<z.infer<typeof participantSchema>[]>().notNull().default([]),
  transcript: jsonb("transcript").$type<z.infer<typeof transcriptEntrySchema>[]>().notNull().default([]),
  notes: jsonb("notes").$type<z.infer<typeof meetingNotesSchema> | null>(),
});

export type MeetingRow = typeof meetingsTable.$inferSelect;
export type NewMeeting = typeof meetingsTable.$inferInsert;