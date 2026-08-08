import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AppendTranscriptBody,
  AppendTranscriptParams,
  AppendTranscriptResponse,
  CreateMeetingBody,
  CreateMeetingResponse,
  EndMeetingParams,
  EndMeetingResponse,
  GenerateMeetingNotesParams,
  GenerateMeetingNotesResponse,
  GetDashboardResponse,
  GetMeetingParams,
  GetMeetingResponse,
  JoinMeetingParams,
  JoinMeetingResponse,
  ListMeetingHistoryResponse,
  ListMeetingsQueryParams,
  ListMeetingsResponse,
  UpdateMeetingBody,
  UpdateMeetingParams,
  UpdateMeetingResponse,
} from "@workspace/api-zod";
import { db, meetingsTable, type MeetingRow } from "@workspace/db";

const router: IRouter = Router();
const DEMO_USER_ID = "demo-user";

type Participant = NonNullable<MeetingRow["participants"]>[number];
type TranscriptEntry = NonNullable<MeetingRow["transcript"]>[number];
type Notes = NonNullable<MeetingRow["notes"]>;

function getUserId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const header = req.headers["x-user-id"];
  return typeof header === "string" && header.trim() ? header.trim() : DEMO_USER_ID;
}

function normalizeDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeMeeting(row: MeetingRow) {
  const participants = (row.participants ?? []).map((participant) => ({
    ...participant,
    joinedAt: normalizeDate(participant.joinedAt),
  }));
  const transcript = (row.transcript ?? []).map((entry) => ({
    ...entry,
    createdAt: normalizeDate(entry.createdAt),
  }));
  const notes = row.notes
    ? {
        ...row.notes,
        generatedAt: normalizeDate(row.notes.generatedAt),
      }
    : null;

  return {
    ...row,
    createdAt: normalizeDate(row.createdAt),
    startedAt: normalizeDate(row.startedAt),
    endedAt: row.endedAt ? normalizeDate(row.endedAt) : null,
    status: row.status as "live" | "scheduled" | "ended",
    participants,
    transcript,
    notes,
    participantCount: participants.length,
  };
}

async function findMeeting(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(meetingsTable)
    .where(and(eq(meetingsTable.id, id), eq(meetingsTable.hostId, userId)));
  return row;
}

function buildNotes(transcript: TranscriptEntry[]): Notes {
  const lines = transcript.map((entry) => entry.text.trim()).filter(Boolean);
  const joined = lines.join(" ");
  const sentences = joined
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const keyPoints = sentences.slice(0, 4);
  const decisions = sentences.filter((sentence) =>
    /\b(decided|decision|agreed|approve|approved|confirmed|alignment)\b/i.test(sentence),
  ).slice(0, 3);
  const actionItems = sentences.filter((sentence) =>
    /\b(action|todo|to-do|should|need to|will|owner|follow up)\b/i.test(sentence),
  ).slice(0, 4);

  return {
    summary: joined
      ? `This meeting covered ${sentences.slice(0, 2).join(" ")}`
      : "No transcript was captured for this meeting.",
    keyPoints: keyPoints.length ? keyPoints : ["No key discussion points were captured."],
    decisions: decisions.length ? decisions : ["No explicit decisions were detected."],
    actionItems: actionItems.length ? actionItems : ["No action items were detected."],
    followUps: actionItems.length
      ? actionItems.map((item) => `Follow up on: ${item}`)
      : ["Review the transcript and add any follow-ups manually."],
    generatedAt: new Date(),
  };
}

router.get("/meetings", async (req, res): Promise<void> => {
  const parsed = ListMeetingsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = getUserId(req);
  const rows = await db
    .select()
    .from(meetingsTable)
    .where(eq(meetingsTable.hostId, userId))
    .orderBy(desc(meetingsTable.startedAt));
  const filtered = parsed.data.status && parsed.data.status !== "all"
    ? rows.filter((meeting) => meeting.status === parsed.data.status)
    : rows;
  res.json(ListMeetingsResponse.parse(filtered.map(normalizeMeeting)));
});

router.post("/meetings", async (req, res): Promise<void> => {
  const parsed = CreateMeetingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = getUserId(req);
  const now = new Date();
  const participant: Participant = {
    id: userId,
    name: parsed.data.hostName,
    role: "Host",
    joinedAt: now,
    isMuted: false,
    cameraOn: true,
  };
  const [row] = await db.insert(meetingsTable).values({
    id: crypto.randomUUID().slice(0, 8).toUpperCase(),
    title: parsed.data.title,
    hostId: userId,
    hostName: parsed.data.hostName,
    createdAt: now,
    startedAt: now,
    status: "live",
    participants: [participant],
    transcript: [],
    notes: null,
  }).returning();
  res.status(201).json(CreateMeetingResponse.parse(normalizeMeeting(row)));
});

router.get("/meetings/:meetingId", async (req, res): Promise<void> => {
  const params = GetMeetingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const row = await findMeeting(params.data.meetingId, getUserId(req));
  if (!row) {
    res.status(404).json({ error: "Meeting not found" });
    return;
  }
  res.json(GetMeetingResponse.parse(normalizeMeeting(row)));
});

router.patch("/meetings/:meetingId", async (req, res): Promise<void> => {
  const params = UpdateMeetingParams.safeParse(req.params);
  const body = UpdateMeetingBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: params.success
        ? body.success
          ? "Invalid request"
          : body.error?.message ?? "Invalid request"
        : params.error.message,
    });
    return;
  }
  const existing = await findMeeting(params.data.meetingId, getUserId(req));
  if (!existing) {
    res.status(404).json({ error: "Meeting not found" });
    return;
  }
  const [row] = await db.update(meetingsTable).set({
    ...body.data,
    endedAt: body.data.endedAt === undefined ? existing.endedAt : body.data.endedAt,
  }).where(eq(meetingsTable.id, params.data.meetingId)).returning();
  res.json(UpdateMeetingResponse.parse(normalizeMeeting(row)));
});

router.post("/meetings/:meetingId/join", async (req, res): Promise<void> => {
  const params = JoinMeetingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = getUserId(req);
  const existing = await findMeeting(params.data.meetingId, userId);
  if (!existing) {
    res.status(404).json({ error: "Only the meeting host can access this demo room." });
    return;
  }
  res.json(JoinMeetingResponse.parse(normalizeMeeting(existing)));
});

router.post("/meetings/:meetingId/transcript", async (req, res): Promise<void> => {
  const params = AppendTranscriptParams.safeParse(req.params);
  const body = AppendTranscriptBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: params.success
        ? body.success
          ? "Invalid request"
          : body.error?.message ?? "Invalid request"
        : params.error.message,
    });
    return;
  }
  const existing = await findMeeting(params.data.meetingId, getUserId(req));
  if (!existing) {
    res.status(404).json({ error: "Meeting not found" });
    return;
  }
  const entry: TranscriptEntry = {
    id: crypto.randomUUID(),
    speaker: body.data.speaker,
    text: body.data.text,
    createdAt: new Date(),
  };
  const [row] = await db.update(meetingsTable).set({
    transcript: [...(existing.transcript ?? []), entry],
  }).where(eq(meetingsTable.id, params.data.meetingId)).returning();
  res.json(AppendTranscriptResponse.parse(normalizeMeeting(row)));
});

router.post("/meetings/:meetingId/end", async (req, res): Promise<void> => {
  const params = EndMeetingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const existing = await findMeeting(params.data.meetingId, getUserId(req));
  if (!existing) {
    res.status(404).json({ error: "Meeting not found" });
    return;
  }
  const endedAt = new Date();
  const [row] = await db.update(meetingsTable).set({
    status: "ended",
    endedAt,
    notes: buildNotes(existing.transcript ?? []),
  }).where(eq(meetingsTable.id, params.data.meetingId)).returning();
  res.json(EndMeetingResponse.parse(normalizeMeeting(row)));
});

router.post("/meetings/:meetingId/notes", async (req, res): Promise<void> => {
  const params = GenerateMeetingNotesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const existing = await findMeeting(params.data.meetingId, getUserId(req));
  if (!existing) {
    res.status(404).json({ error: "Meeting not found" });
    return;
  }
  if (existing.notes) {
    res.json(GenerateMeetingNotesResponse.parse(normalizeMeeting(existing)));
    return;
  }
  const [row] = await db.update(meetingsTable).set({
    notes: buildNotes(existing.transcript ?? []),
  }).where(eq(meetingsTable.id, params.data.meetingId)).returning();
  res.json(GenerateMeetingNotesResponse.parse(normalizeMeeting(row)));
});

router.get("/history", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(meetingsTable)
    .where(and(eq(meetingsTable.hostId, getUserId(req)), eq(meetingsTable.status, "ended")))
    .orderBy(desc(meetingsTable.endedAt));
  res.json(ListMeetingHistoryResponse.parse(rows.map(normalizeMeeting)));
});

router.get("/dashboard", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(meetingsTable)
    .where(eq(meetingsTable.hostId, getUserId(req)))
    .orderBy(desc(meetingsTable.startedAt));
  const ended = rows.filter((row) => row.status === "ended");
  const actionItems = ended.reduce((total, row) => total + (row.notes?.actionItems.length ?? 0), 0);
  res.json(GetDashboardResponse.parse({
    totalMeetings: rows.length,
    liveMeetings: rows.filter((row) => row.status === "live").length,
    summaries: ended.filter((row) => row.notes).length,
    actionItems,
    hoursSaved: Number((actionItems * 0.25).toFixed(1)),
    recent: rows.filter((row) => row.status === "ended").slice(0, 4).map(normalizeMeeting),
    upcoming: rows.filter((row) => row.status !== "ended").slice(0, 4).map(normalizeMeeting),
  }));
});

export default router;