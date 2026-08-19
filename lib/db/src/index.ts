import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import type { MeetingRow, NewMeeting } from "./schema/meetings";
import type { ProfileRow, NewProfile } from "./schema/profiles";

const { Pool } = pg;

export const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

function createInMemoryDb() {
  const now = new Date();
  const meetings: MeetingRow[] = [
    {
      id: "SHIP-01",
      title: "Friday ship check",
      hostId: "demo-user",
      hostName: "Ari Mendoza",
      createdAt: new Date(now.getTime() - 40 * 60 * 1000),
      startedAt: new Date(now.getTime() - 40 * 60 * 1000),
      endedAt: null,
      status: "live",
      participants: [
        {
          id: "demo-user",
          name: "Ari Mendoza",
          role: "Host",
          joinedAt: new Date(now.getTime() - 40 * 60 * 1000),
          isMuted: false,
          cameraOn: true,
        },
        {
          id: "p2",
          name: "Mika Chen",
          role: "Participant",
          joinedAt: new Date(now.getTime() - 35 * 60 * 1000),
          isMuted: false,
          cameraOn: true,
        },
      ],
      transcript: [
        {
          id: "t1",
          speaker: "Ari Mendoza",
          text: "Let's review the mobile build release before end of day.",
          createdAt: new Date(now.getTime() - 30 * 60 * 1000),
        },
        {
          id: "t2",
          speaker: "Mika Chen",
          text: "All tests passed on iOS and Android. Ready to ship.",
          createdAt: new Date(now.getTime() - 25 * 60 * 1000),
        },
      ],
      notes: null,
    },
    {
      id: "PROD-02",
      title: "Design system review",
      hostId: "demo-user",
      hostName: "Ari Mendoza",
      createdAt: new Date(now.getTime() - 3 * 3600 * 1000),
      startedAt: new Date(now.getTime() - 3 * 3600 * 1000),
      endedAt: new Date(now.getTime() - 2 * 3600 * 1000),
      status: "ended",
      participants: [
        {
          id: "demo-user",
          name: "Ari Mendoza",
          role: "Host",
          joinedAt: new Date(now.getTime() - 3 * 3600 * 1000),
          isMuted: false,
          cameraOn: true,
        },
      ],
      transcript: [
        {
          id: "t3",
          speaker: "Ari Mendoza",
          text: "We decided to keep the dark mode aesthetic and ship responsive audio waveforms.",
          createdAt: new Date(now.getTime() - 2.8 * 3600 * 1000),
        },
        {
          id: "t4",
          speaker: "Ari Mendoza",
          text: "Action item is to verify camera and microphone permissions across all browsers.",
          createdAt: new Date(now.getTime() - 2.5 * 3600 * 1000),
        },
      ],
      notes: {
        summary: "Reviewed the updated dark visual system, high-contrast layouts, and live transcript streaming.",
        keyPoints: ["Keep dark theme aesthetic", "Waveform responsive design", "Local camera preview active"],
        decisions: ["Approved dark theme styling", "Confirmed single-user room flow"],
        actionItems: ["Verify camera and microphone controls", "Test local video preview"],
        followUps: ["Follow up on: Verify camera and microphone controls"],
        generatedAt: new Date(now.getTime() - 2 * 3600 * 1000),
      },
    },
  ];

  const profiles: ProfileRow[] = [
    {
      userId: "demo-user",
      name: "Ari Mendoza",
      email: "ari@yourcrew.co",
      bio: "Product lead",
      timezone: "America/Los_Angeles",
      language: "English",
      role: "Product lead",
      updatedAt: now,
    },
  ];

  function extractStringFromCondition(cond: any): string | null {
    if (!cond) return null;
    if (typeof cond === "string") return cond;
    if (typeof cond === "number") return String(cond);
    if (cond.value && typeof cond.value === "string") return cond.value;
    if (Array.isArray(cond.queryChunks)) {
      for (const chunk of cond.queryChunks) {
        if (chunk && chunk.encoder && chunk.value !== undefined) {
          return typeof chunk.value === "string" ? chunk.value : String(chunk.value);
        }
        if (chunk && typeof chunk.value === "string" && !Array.isArray(chunk.value)) {
          return chunk.value;
        }
      }
    }
    return null;
  }

  return {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: any) => {
          const execute = () => {
            const isMeetings = table === schema.meetingsTable;
            if (isMeetings) {
              const idSearch = extractStringFromCondition(condition);
              if (idSearch) {
                const found = meetings.find((m) => m.id === idSearch);
                if (found) return [found];
              }
              return [...meetings];
            }
            const userIdSearch = extractStringFromCondition(condition);
            if (userIdSearch) {
              const found = profiles.find((p) => p.userId === userIdSearch);
              if (found) return [found];
            }
            return [...profiles];
          };

          return {
            orderBy: () => Promise.resolve(execute()),
            then: (onfulfilled: (res: any) => any) => Promise.resolve(execute()).then(onfulfilled),
            [Symbol.toStringTag]: "Promise",
          };
        },
        orderBy: () => Promise.resolve(table === schema.meetingsTable ? [...meetings] : [...profiles]),
        then: (onfulfilled: (res: any) => any) => Promise.resolve(table === schema.meetingsTable ? [...meetings] : [...profiles]).then(onfulfilled),
        [Symbol.toStringTag]: "Promise",
      }),
    }),
    insert: (table: unknown) => ({
      values: (val: any) => {
        const isMeetings = table === schema.meetingsTable;
        let inserted: any;
        if (isMeetings) {
          const newMeeting = { ...val } as MeetingRow;
          meetings.unshift(newMeeting);
          inserted = newMeeting;
        } else {
          const newProfile = { ...val, updatedAt: new Date() } as ProfileRow;
          const existingIndex = profiles.findIndex((p) => p.userId === newProfile.userId);
          if (existingIndex >= 0) {
            inserted = profiles[existingIndex];
          } else {
            profiles.push(newProfile);
            inserted = newProfile;
          }
        }

        return {
          onConflictDoNothing: () => Promise.resolve([inserted]),
          returning: () => Promise.resolve([inserted]),
          then: (onfulfilled: (res: any) => any) => Promise.resolve([inserted]).then(onfulfilled),
          [Symbol.toStringTag]: "Promise",
        };
      },
    }),
    update: (table: unknown) => ({
      set: (updates: any) => ({
        where: (condition: any) => {
          const execute = () => {
            const isMeetings = table === schema.meetingsTable;
            if (isMeetings) {
              const id = extractStringFromCondition(condition);
              const target = id ? meetings.find((m) => m.id === id) : meetings[0];
              if (target) {
                Object.assign(target, updates);
                if (updates.participants) target.participants = [...updates.participants];
                if (updates.transcript) target.transcript = [...updates.transcript];
              }
              return target ? [target] : [];
            }
            const userId = extractStringFromCondition(condition);
            const profile = userId ? profiles.find((p) => p.userId === userId) : profiles[0];
            if (profile) Object.assign(profile, updates);
            return profile ? [profile] : [];
          };

          return {
            returning: () => Promise.resolve(execute()),
            then: (onfulfilled: (res: any) => any) => Promise.resolve(execute()).then(onfulfilled),
            [Symbol.toStringTag]: "Promise",
          };
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (condition: any) => {
        const isMeetings = table === schema.meetingsTable;
        if (isMeetings) {
          const id = extractStringFromCondition(condition);
          if (id) {
            const index = meetings.findIndex((m) => m.id === id);
            if (index >= 0) meetings.splice(index, 1);
          }
        }
        return Promise.resolve();
      },
    }),
  } as unknown as ReturnType<typeof drizzle>;
}

export const db = pool
  ? drizzle(pool, { schema })
  : createInMemoryDb();

export * from "./schema";
