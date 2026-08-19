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
import { db, meetingsTable, profilesTable, type MeetingRow } from "@workspace/db";

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

async function findMeeting(id: string) {
  const [row] = await db
    .select()
    .from(meetingsTable)
    .where(eq(meetingsTable.id, id));
  return row;
}

function buildLocalNotes(transcript: TranscriptEntry[]): Notes {
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim());
}

function parseAiNotes(value: unknown): Omit<Notes, "generatedAt"> | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.summary !== "string" || !candidate.summary.trim()) return null;
  if (!isStringArray(candidate.keyPoints) || !isStringArray(candidate.decisions)) return null;
  if (!isStringArray(candidate.actionItems) || !isStringArray(candidate.followUps)) return null;

  return {
    summary: candidate.summary.trim(),
    keyPoints: candidate.keyPoints.map((item) => item.trim()).filter(Boolean).slice(0, 6),
    decisions: candidate.decisions.map((item) => item.trim()).filter(Boolean).slice(0, 6),
    actionItems: candidate.actionItems.map((item) => item.trim()).filter(Boolean).slice(0, 6),
    followUps: candidate.followUps.map((item) => item.trim()).filter(Boolean).slice(0, 6),
  };
}

async function buildNotes(transcript: TranscriptEntry[]): Promise<Notes> {
  const fallback = buildLocalNotes(transcript);
  const apiKey = process.env.OPENAI_API_KEY;
  const transcriptText = transcript
    .map((entry) => `${entry.speaker}: ${entry.text.trim()}`)
    .filter((line) => !line.endsWith(":"))
    .join("\n")
    .slice(0, 16_000);

  if (!apiKey || !transcriptText) return fallback;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        max_completion_tokens: 1400,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You create concise meeting notes. Return only valid JSON with exactly these keys: summary (string), keyPoints (string[]), decisions (string[]), actionItems (string[]), followUps (string[]). Do not invent details. Use empty arrays when the transcript does not support a category.",
          },
          {
            role: "user",
            content: `Summarize this meeting transcript:\n\n${transcriptText}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) return fallback;
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return fallback;
    const parsed = parseAiNotes(JSON.parse(content));
    return parsed ? { ...parsed, generatedAt: new Date() } : fallback;
  } catch {
    return fallback;
  }
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
    .orderBy(desc(meetingsTable.startedAt));
  const userMeetings = rows.filter((m) => m.hostId === userId || (m.participants ?? []).some((p) => p.id === userId));
  const filtered = parsed.data.status && parsed.data.status !== "all"
    ? userMeetings.filter((meeting) => meeting.status === parsed.data.status)
    : userMeetings;
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
  const row = await findMeeting(params.data.meetingId);
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
  const existing = await findMeeting(params.data.meetingId);
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
  const existing = await findMeeting(params.data.meetingId);
  if (!existing) {
    res.status(404).json({ error: "Meeting not found." });
    return;
  }
  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, userId));
  const candidateName = (typeof req.body?.name === "string" && req.body.name.trim())
    ? req.body.name.trim()
    : (profile?.name && profile.name !== "Participant"
        ? profile.name
        : (userId === existing.hostId ? existing.hostName : "Participant"));

  const participants = existing.participants ?? [];
  const existingIndex = participants.findIndex((p) => p.id === userId);
  let updatedParticipants = [...participants];
  if (existingIndex >= 0) {
    if (candidateName && candidateName !== "Participant") {
      updatedParticipants[existingIndex] = {
        ...updatedParticipants[existingIndex],
        name: candidateName,
      };
    }
  } else {
    updatedParticipants.push({
      id: userId,
      name: candidateName,
      role: userId === existing.hostId ? "Host" : "Participant",
      joinedAt: new Date(),
      isMuted: false,
      cameraOn: true,
    });
  }
  const [row] = await db.update(meetingsTable).set({
    participants: updatedParticipants,
  }).where(eq(meetingsTable.id, params.data.meetingId)).returning();
  res.json(JoinMeetingResponse.parse(normalizeMeeting(row)));
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
  const existing = await findMeeting(params.data.meetingId);
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
  const existing = await findMeeting(params.data.meetingId);
  if (!existing) {
    res.status(404).json({ error: "Meeting not found" });
    return;
  }
  const endedAt = new Date();
  const [row] = await db.update(meetingsTable).set({
    status: "ended",
    endedAt,
    notes: await buildNotes(existing.transcript ?? []),
  }).where(eq(meetingsTable.id, params.data.meetingId)).returning();
  res.json(EndMeetingResponse.parse(normalizeMeeting(row)));
});

router.post("/meetings/:meetingId/notes", async (req, res): Promise<void> => {
  const params = GenerateMeetingNotesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const existing = await findMeeting(params.data.meetingId);
  if (!existing) {
    res.status(404).json({ error: "Meeting not found" });
    return;
  }
  if (existing.notes) {
    res.json(GenerateMeetingNotesResponse.parse(normalizeMeeting(existing)));
    return;
  }
  const [row] = await db.update(meetingsTable).set({
    notes: await buildNotes(existing.transcript ?? []),
  }).where(eq(meetingsTable.id, params.data.meetingId)).returning();
  res.json(GenerateMeetingNotesResponse.parse(normalizeMeeting(row)));
});

router.get("/history", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const rows = await db
    .select()
    .from(meetingsTable)
    .where(eq(meetingsTable.status, "ended"))
    .orderBy(desc(meetingsTable.endedAt));
  const userMeetings = rows.filter((m) => m.hostId === userId || (m.participants ?? []).some((p) => p.id === userId));
  res.json(ListMeetingHistoryResponse.parse(userMeetings.map(normalizeMeeting)));
});

router.get("/dashboard", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const rows = await db
    .select()
    .from(meetingsTable)
    .orderBy(desc(meetingsTable.startedAt));
  const userMeetings = rows.filter((m) => m.hostId === userId || (m.participants ?? []).some((p) => p.id === userId));
  const ended = userMeetings.filter((row) => row.status === "ended");
  const actionItems = ended.reduce((total, row) => total + (row.notes?.actionItems.length ?? 0), 0);
  res.json(GetDashboardResponse.parse({
    totalMeetings: userMeetings.length,
    liveMeetings: userMeetings.filter((row) => row.status === "live").length,
    summaries: ended.filter((row) => row.notes).length,
    actionItems,
    hoursSaved: Number((actionItems * 0.25).toFixed(1)),
    recent: userMeetings.filter((row) => row.status === "ended").slice(0, 4).map(normalizeMeeting),
    upcoming: userMeetings.filter((row) => row.status !== "ended").slice(0, 4).map(normalizeMeeting),
  }));
});

export default router;