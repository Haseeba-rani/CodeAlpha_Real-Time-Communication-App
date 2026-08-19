import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetProfileResponse,
  UpdateProfileBody,
  UpdateProfileResponse,
} from "@workspace/api-zod";
import { db, profilesTable } from "@workspace/db";

const router: IRouter = Router();
const DEMO_USER_ID = "demo-user";
const DEFAULT_PROFILE = {
  userId: DEMO_USER_ID,
  name: "Participant",
  email: "",
  bio: "",
  timezone: "America/Los_Angeles",
  language: "English",
  role: "Member",
};

function getUserId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const header = req.headers["x-user-id"];
  return typeof header === "string" && header.trim() ? header.trim() : DEMO_USER_ID;
}

async function ensureProfile(userId: string) {
  await db.insert(profilesTable).values({ ...DEFAULT_PROFILE, userId }).onConflictDoNothing();
  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, userId));
  return profile;
}

function normalizeProfile(profile: NonNullable<Awaited<ReturnType<typeof ensureProfile>>>) {
  return {
    ...profile,
    updatedAt: profile.updatedAt instanceof Date ? profile.updatedAt : new Date(profile.updatedAt),
  };
}

router.get("/profile", async (req, res): Promise<void> => {
  const profile = await ensureProfile(getUserId(req));
  res.json(GetProfileResponse.parse(normalizeProfile(profile)));
});

router.patch("/profile", async (req, res): Promise<void> => {
  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = getUserId(req);
  await ensureProfile(userId);
  const [profile] = await db.update(profilesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(profilesTable.userId, userId))
    .returning();
  res.json(UpdateProfileResponse.parse(normalizeProfile(profile)));
});

export default router;