import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import type { Meeting, Profile } from "@workspace/api-client-react";
import { db } from "@/lib/firebase";

export type FirestoreProfile = Pick<Profile, "name" | "email" | "bio" | "timezone" | "language" | "role"> & {
  updatedAt?: unknown;
};

export async function getStoredProfile(userId: string) {
  const snapshot = await getDoc(doc(db, "users", userId));
  return snapshot.exists() ? (snapshot.data() as FirestoreProfile) : null;
}

export async function saveStoredProfile(userId: string, profile: FirestoreProfile) {
  await setDoc(doc(db, "users", userId), { ...profile, updatedAt: serverTimestamp() }, { merge: true });
}

export async function saveStoredMeeting(userId: string, meeting: Meeting) {
  await setDoc(
    doc(db, "users", userId, "meetings", meeting.id),
    { ...meeting, hostId: userId, syncedAt: serverTimestamp() },
    { merge: true },
  );
}