import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateMeeting, useEndMeeting, useGenerateMeetingNotes, useGetDashboard, useGetMeeting, useJoinMeeting, useListMeetingHistory, useListMeetings, useAppendTranscript, getGetDashboardQueryKey, getGetMeetingQueryKey, getListMeetingsQueryKey, getListMeetingHistoryQueryKey } from '@workspace/api-client-react';
import { useGetProfile } from '@workspace/api-client-react';
import type { Meeting } from '@workspace/api-client-react';
import { ArrowLeft, ArrowUpRight, CalendarDays, Check, ChevronRight, CircleHelp, Copy, FileText, Filter, Mic, MicOff, MoreHorizontal, Paperclip, Pen, Play, Plus, Radio, RefreshCw, Search, Send, Share2, Sparkles, Timer, Users, Video, VideoOff } from 'lucide-react';
import { AppShell, AvatarStack, EmptyState, ErrorState, formatDate, formatTime, Logo, PageHeading, Skeleton, StatusPill } from '@/components/meet-shell';
import { SharedFilesCard } from '@/components/shared-files';
import { WhiteboardModal } from '@/components/whiteboard-modal';
import { auth } from '@/lib/firebase';
import { saveStoredMeeting, saveStoredProfile } from '@/lib/firestore';
import { useAuth } from '@/lib/auth-context';
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { useWebRTC } from '@/lib/webrtc';

function initials(name: string) { return name ? name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase() : 'U'; }

// ── Tap-gesture effect (clean, no emoji overlay) ─────────────────────────────
type TapEffectEntry = { id: number; x: number; y: number };
let tapIdCounter = 0;

function TapEffectsLayer(_props: { effects: TapEffectEntry[]; onDone: (id: number) => void }) {
  return null;
}

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: { ideal: true },
  noiseSuppression: { ideal: true },
  autoGainControl: { ideal: true },
};

export type MediaAcquisitionResult = {
  stream: MediaStream;
  videoActive: boolean;
  audioActive: boolean;
  warning?: { title: string; detail: string };
};

/**
 * Acquires local media with graceful fallback:
 * 1. Attempts ideal 720p video + audio
 * 2. Attempts relaxed video + audio
 * 3. Falls back to independent audio capture if camera is in use (e.g. on Windows DirectShow)
 * 4. Falls back to independent video capture if mic is busy
 */
async function acquireLocalMediaStream(): Promise<MediaAcquisitionResult> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new DOMException('Media devices are not supported in this browser.', 'NotSupportedError');
  }

  // 1. Try 720p ideal video + audio
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: AUDIO_CONSTRAINTS,
    });
    console.log('[MediaCapture] Successfully acquired 720p camera and microphone stream.');
    return { stream, videoActive: true, audioActive: true };
  } catch (err1) {
    console.warn('[MediaCapture] 720p capture failed, attempting relaxed constraints:', (err1 as Error)?.name, (err1 as Error)?.message);
  }

  // 2. Try relaxed video + audio
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: AUDIO_CONSTRAINTS,
    });
    console.log('[MediaCapture] Successfully acquired basic camera and microphone stream.');
    return { stream, videoActive: true, audioActive: true };
  } catch (err2) {
    console.warn('[MediaCapture] Combined capture failed, attempting independent track acquisition:', (err2 as Error)?.name, (err2 as Error)?.message);
  }

  // 3. Independent Audio Capture + Video Capture
  let audioStream: MediaStream | null = null;
  let videoStream: MediaStream | null = null;
  let audioErr: unknown = null;
  let videoErr: unknown = null;

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: AUDIO_CONSTRAINTS,
      video: false,
    });
    console.log('[MediaCapture] Successfully acquired independent audio stream.');
  } catch (aErr) {
    console.warn('[MediaCapture] Independent audio capture failed:', (aErr as Error)?.name, (aErr as Error)?.message);
    audioErr = aErr;
  }

  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });
    console.log('[MediaCapture] Successfully acquired independent video stream.');
  } catch (vErr) {
    console.warn('[MediaCapture] Independent video capture failed (camera may be in use by another tab/app):', (vErr as Error)?.name, (vErr as Error)?.message);
    videoErr = vErr;
  }

  if (!audioStream && !videoStream) {
    throw videoErr || audioErr || new Error('Could not access camera or microphone.');
  }

  const combined = new MediaStream();
  if (audioStream) {
    audioStream.getAudioTracks().forEach((t) => combined.addTrack(t));
  }
  if (videoStream) {
    videoStream.getVideoTracks().forEach((t) => combined.addTrack(t));
  }

  let warning: { title: string; detail: string } | undefined;
  if (!videoStream && audioStream) {
    warning = {
      title: 'Camera In Use by Another Tab/App',
      detail: 'Your physical camera is busy with another application or tab. Your microphone is fully connected and ready.',
    };
  } else if (!audioStream && videoStream) {
    warning = {
      title: 'Microphone Unavailable',
      detail: 'Your microphone is currently unavailable. Your camera video is connected and ready.',
    };
  }

  return {
    stream: combined,
    videoActive: Boolean(videoStream),
    audioActive: Boolean(audioStream),
    warning,
  };
}

function useTapEffect() {
  const [effects, setEffects] = useState<TapEffectEntry[]>([]);
  const trigger = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const id = ++tapIdCounter;
    setEffects((prev) => [...prev, { id, x, y }]);
  }, []);
  const remove = useCallback((id: number) => {
    setEffects((prev) => prev.filter((e) => e.id !== id));
  }, []);
  return { effects, trigger, remove };
}

/**
 * Idempotently and safely closes an AudioContext without throwing "Cannot close a closed AudioContext"
 */
function safeCloseAudioContext(
  ctxRef: React.MutableRefObject<AudioContext | null>,
  analyserRef?: React.MutableRefObject<AnalyserNode | null>,
) {
  if (analyserRef?.current) {
    try {
      analyserRef.current.disconnect();
    } catch {}
    analyserRef.current = null;
  }
  const ctx = ctxRef.current;
  ctxRef.current = null;
  if (ctx && ctx.state !== 'closed') {
    try {
      void ctx.close().catch(() => {});
    } catch {}
  }
}

/**
 * Parses getUserMedia / device errors into clear, actionable user messages
 */
function getMediaErrorMessage(err: unknown): { title: string; detail: string; isPermission: boolean } {
  if (
    typeof window !== 'undefined' &&
    !window.isSecureContext &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1'
  ) {
    return {
      title: 'Secure Connection (HTTPS) Required',
      detail:
        'Camera and microphone access requires HTTPS or localhost. If joining from another device over LAN, use an HTTPS tunnel or supported secure origin.',
      isPermission: false,
    };
  }

  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return {
      title: 'Media Devices Unsupported',
      detail: 'Camera and microphone APIs are not supported in this browser or context.',
      isPermission: false,
    };
  }

  if (err instanceof DOMException || (typeof err === 'object' && err !== null && 'name' in err)) {
    const errorName = (err as { name: string }).name;
    switch (errorName) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return {
          title: 'Permission Denied',
          detail:
            'Camera or microphone access was blocked. Please click the camera/lock icon in your browser address bar to allow permissions and reload.',
          isPermission: true,
        };
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return {
          title: 'No Camera or Microphone Found',
          detail: 'No camera or microphone hardware was detected. Please connect a device and try again.',
          isPermission: false,
        };
      case 'NotReadableError':
      case 'TrackStartError':
        return {
          title: 'Device in Use by Another App',
          detail:
            'Your camera or microphone is in use by another application (Zoom, Teams, or another tab). Please close other apps and try again.',
          isPermission: false,
        };
      case 'OverconstrainedError':
        return {
          title: 'Constraints Unsupported',
          detail: 'The requested video/audio resolution is not supported by your hardware.',
          isPermission: false,
        };
      case 'SecurityError':
        return {
          title: 'Security Context Restriction',
          detail: 'The browser blocked media device access due to iframe or origin security restrictions.',
          isPermission: false,
        };
      default:
        return {
          title: 'Media Access Error',
          detail: `Could not start camera or microphone (${errorName}). Please check permissions and try again.`,
          isPermission: false,
        };
    }
  }

  return {
    title: 'Media Access Error',
    detail: 'An unexpected error occurred while accessing camera or microphone.',
    isPermission: false,
  };
}

type SpeechRecognitionResultListLike = {
  length: number;
  [index: number]: { isFinal: boolean; [index: number]: { transcript: string } };
};
type SpeechRecognitionEventLike = { resultIndex: number; results: SpeechRecognitionResultListLike };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | undefined {
  const speechWindow = window as typeof window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

function MeetingRow({ meeting, onJoin }: { meeting: Meeting; onJoin?: (id: string) => void }) {
  const tap = useTapEffect();
  return <Link href={`/meetings/${meeting.id}`} className="group flex flex-col gap-4 border-b border-border/70 py-5 first:pt-0 last:border-0 sm:flex-row sm:items-center sm:justify-between" data-testid={`row-meeting-${meeting.id}`}>
    <TapEffectsLayer effects={tap.effects} onDone={tap.remove} />
    <div className="flex min-w-0 items-center gap-4"><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl font-display text-sm font-bold ${meeting.status === 'live' ? 'bg-primary/15 text-primary' : 'bg-secondary text-secondary-foreground'}`}>{initials(meeting.title)}</div><div className="min-w-0"><div className="truncate font-semibold group-hover:text-primary">{meeting.title}</div><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><StatusPill status={meeting.status} /><span>{meeting.status === 'ended' ? formatDate(meeting.endedAt) : formatTime(meeting.startedAt)}</span><span className="text-foreground/30">·</span><span>{meeting.participantCount} people</span></div></div></div>
    <div className="flex items-center gap-3 pl-[60px] sm:pl-0">{meeting.status === 'live' && onJoin && <button onClick={(e) => { e.preventDefault(); tap.trigger(e); onJoin(meeting.id); }} className="rounded-lg bg-primary px-3 py-2 text-xs font-extrabold text-primary-foreground" data-testid={`button-join-${meeting.id}`}>Open Room</button>}<ChevronRight size={17} className="text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" /></div>
  </Link>;
}

function CreateMeeting({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, setLocation] = useLocation(); const [title, setTitle] = useState(''); const profile = useGetProfile(); const { user } = useAuth(); const [hostName, setHostName] = useState(''); const create = useCreateMeeting(); const qc = useQueryClient(); const tap = useTapEffect();
  useEffect(() => { if (!hostName) setHostName(profile.data?.name || user?.displayName || ''); }, [profile.data?.name, user?.displayName, hostName]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-background/80 p-5 backdrop-blur-md"><TapEffectsLayer effects={tap.effects} onDone={tap.remove} /><div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-2xl md:p-8"><div className="flex items-start justify-between"><div><div className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">New room</div><h2 className="mt-2 font-display text-3xl font-semibold">What are we making space for?</h2></div><button onClick={(e) => { tap.trigger(e); onClose(); }} className="text-muted-foreground" data-testid="button-close-create">×</button></div><div className="mt-7 space-y-4"><label className="block text-sm font-semibold">Meeting name<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Friday ship check" className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary" data-testid="input-meeting-title" /></label><label className="block text-sm font-semibold">Your name<input value={hostName} onChange={(e) => setHostName(e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary" data-testid="input-host-name" /></label></div><div className="mt-7 flex justify-end gap-3"><button onClick={(e) => { tap.trigger(e); onClose(); }} className="rounded-xl px-4 py-3 text-sm font-bold text-muted-foreground" data-testid="button-cancel-create">Cancel</button><button disabled={!title.trim() || !hostName.trim() || create.isPending} onClick={(e) => { tap.trigger(e); create.mutate({ data: { title: title.trim(), hostName: hostName.trim() } }, { onSuccess: (meeting) => { if (user) void saveStoredMeeting(user.uid, meeting); qc.invalidateQueries({ queryKey: getListMeetingsQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); setLocation(`/meetings/${meeting.id}`); } }); }} className="rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-primary-foreground disabled:opacity-50" data-testid="button-create-meeting">{create.isPending ? 'Opening room…' : 'Open live room'}</button></div></div></div>;
}

function TypewriterHeadline({ text }: { text: string }) {
  const [displayed, setDisplayed] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    if (!isDeleting && displayed === text) {
      timeout = setTimeout(() => setIsDeleting(true), 2500);
    } else if (isDeleting && displayed === '') {
      timeout = setTimeout(() => setIsDeleting(false), 500);
    } else {
      const speed = isDeleting ? 50 : 100;
      timeout = setTimeout(() => {
        setDisplayed(
          isDeleting
            ? text.slice(0, displayed.length - 1)
            : text.slice(0, displayed.length + 1)
        );
      }, speed);
    }
    return () => clearTimeout(timeout);
  }, [displayed, isDeleting, text]);

  return (
    <span className="inline-flex items-baseline">
      <span>{displayed}</span>
      <span className="inline-block animate-pulse ml-1 text-primary font-light">|</span>
    </span>
  );
}

export function Landing() {
  const [, setLocation] = useLocation(); const [createOpen, setCreateOpen] = useState(false); const tap = useTapEffect();
  return <div className="min-h-[100dvh] overflow-hidden bg-background text-foreground"><TapEffectsLayer effects={tap.effects} onDone={tap.remove} /><header className="relative z-10 flex items-center justify-between px-6 py-6 md:px-12"><div className="flex items-center gap-3"><img src="/logo.svg" alt="Gen Z Meet" className="h-9 w-auto rounded-lg object-contain shadow-md" /><span className="font-display text-lg font-semibold">gen z meet<span className="text-primary">.</span></span></div><div className="flex items-center gap-3"><Link href="/login" className="rounded-lg px-3 py-2 text-sm font-bold text-muted-foreground hover:text-foreground" data-testid="link-login">Sign in</Link><Link href="/signup" className="rounded-lg border border-border px-4 py-2 text-sm font-bold hover:bg-muted" data-testid="link-signup">Get started</Link></div></header><main className="relative mx-auto max-w-7xl px-6 pb-20 pt-16 md:px-12 md:pt-24"><div className="pointer-events-none absolute -right-28 top-10 h-[480px] w-[480px] rounded-full bg-accent/10 blur-[100px]" /><div className="pointer-events-none absolute -left-40 top-60 h-[360px] w-[360px] rounded-full bg-primary/10 blur-[100px]" /><div className="relative grid items-center gap-16 lg:grid-cols-[1.05fr_.95fr]"><div className="animate-rise"><div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/5 px-3 py-1.5 font-mono-ui text-[10px] uppercase tracking-[.16em] text-primary"><span className="live-dot h-1.5 w-1.5 rounded-full bg-primary" /> For teams who actually talk</div><h1 className="max-w-3xl text-[clamp(2.5rem,5.5vw,4.8rem)] font-bold leading-[1.12] tracking-tight text-foreground" style={{ fontFamily: '"Times New Roman", Times, serif' }}><div className="font-bold whitespace-nowrap" style={{ fontFamily: '"Times New Roman", Times, serif' }}>Make the room</div><div className="text-primary mt-1 font-bold whitespace-nowrap" style={{ fontFamily: '"Times New Roman", Times, serif' }}><TypewriterHeadline text="Keep the signal" /></div></h1><p className="mt-8 max-w-lg text-base leading-7 text-muted-foreground md:text-lg">A meeting workspace that stays present while you talk — then hands you the good stuff when it’s over.</p><div className="mt-9 flex flex-wrap gap-3"><button onClick={(e) => { tap.trigger(e); setCreateOpen(true); }} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-sm font-extrabold text-primary-foreground shadow-[0_10px_35px_hsl(var(--primary)/.14)] hover:brightness-105" data-testid="button-start-landing"><Play size={16} fill="currentColor" /> Start a meeting</button><button onClick={(e) => { tap.trigger(e); setLocation('/dashboard'); }} className="flex items-center gap-2 rounded-xl border border-border px-5 py-3.5 text-sm font-bold hover:bg-muted" data-testid="button-see-workspace">See the workspace <ArrowUpRight size={16} /></button></div></div><div className="animate-rise-2 relative"><div className="surface-grid relative rounded-[2rem] border border-border bg-card p-4 shadow-2xl md:p-6"><div className="flex items-center justify-between border-b border-border pb-4"><div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.18em] text-muted-foreground"><span className="h-2 w-2 rounded-full bg-primary" /> live room</div><span className="font-mono-ui text-[10px] text-muted-foreground">00:42:18</span></div><div className="grid grid-cols-2 gap-3 pt-4"><div className="col-span-2 rounded-2xl border border-primary/25 bg-primary/[.06] p-5"><div className="flex items-center justify-between"><span className="font-display text-xl font-semibold">Friday ship check</span><StatusPill status="live" /></div><div className="mt-5 flex items-center gap-4"><AvatarStack names={['Ari Mendoza', 'Mika Chen', 'Noah Park', 'Sol Reed']} count={5} /><span className="text-xs text-muted-foreground">5 in the room</span></div></div><div className="rounded-2xl border border-border bg-background p-4"><div className="font-mono-ui text-[10px] uppercase tracking-widest text-muted-foreground">Transcript</div><div className="mt-4 flex items-end gap-1.5">{[34, 58, 42, 70, 48, 82, 56, 72, 38, 64, 46, 74].map((h, i) => <span key={i} className="w-full rounded-full bg-primary/70" style={{ height: `${h / 2}px` }} />)}</div><p className="mt-3 text-xs text-muted-foreground">Capturing as you speak</p></div><div className="rounded-2xl border border-border bg-background p-4"><div className="font-mono-ui text-[10px] uppercase tracking-widest text-muted-foreground">Afterwards</div><div className="mt-4 text-2xl font-semibold text-accent">4<span className="ml-1 text-xs font-normal text-muted-foreground">next moves</span></div><p className="mt-3 text-xs text-muted-foreground">AI notes, no busywork</p></div></div></div><div className="absolute -bottom-5 -left-7 rounded-xl border border-border bg-secondary px-4 py-3 shadow-xl"><div className="flex items-center gap-2 font-mono-ui text-[10px] text-secondary-foreground"><Sparkles size={13} /> notes are ready</div></div></div></div><div className="mt-24 grid gap-4 border-t border-border pt-8 md:grid-cols-3"><div><div className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">01 / while you talk</div><p className="mt-3 max-w-xs font-display text-xl font-semibold">Live transcript, zero tab juggling.</p></div><div><div className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-accent">02 / when you leave</div><p className="mt-3 max-w-xs font-display text-xl font-semibold">The decisions and next moves, already sorted.</p></div><div><div className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">03 / whenever you need</div><p className="mt-3 max-w-xs font-display text-xl font-semibold">A memory for every room you’ve been in.</p></div></div></main><CreateMeeting open={createOpen} onClose={() => setCreateOpen(false)} /></div>;
}

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const [, setLocation] = useLocation(); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState(''); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const signup = mode === 'signup';
  const submit = async () => { setError(''); setMessage(''); try { const credential = signup ? await createUserWithEmailAndPassword(auth, email.trim(), password) : await signInWithEmailAndPassword(auth, email.trim(), password); if (signup) { await updateProfile(credential.user, { displayName: name.trim() }); await saveStoredProfile(credential.user.uid, { name: name.trim(), email: credential.user.email ?? email.trim(), bio: '', timezone: 'America/Los_Angeles', language: 'English', role: '' }); } setLocation('/dashboard'); } catch (cause) { setError(cause instanceof Error ? cause.message.replace('Firebase: ', '').replace(/\s*\(auth\/[^)]+\)\.?/, '') : 'Authentication failed. Please try again.'); } };
  const resetPassword = async () => { setError(''); setMessage(''); try { await sendPasswordResetEmail(auth, email.trim()); setMessage('Password reset email sent. Check your inbox.'); } catch (cause) { setError(cause instanceof Error ? cause.message.replace('Firebase: ', '') : 'Enter your email first, then try again.'); } };
  return <div className="grid min-h-[100dvh] lg:grid-cols-[.9fr_1.1fr]"><div className="surface-grid hidden flex-col justify-between bg-sidebar p-12 lg:flex"><Logo /><div><div className="font-mono-ui text-xs uppercase tracking-[.2em] text-primary">A workspace for the in-between</div><div className="mt-5 max-w-md font-display text-5xl font-semibold leading-[.98] tracking-[-.05em]">The best ideas usually happen after someone says, “wait, what if…”</div></div><div className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-muted-foreground">gen z meet / 2026</div></div><div className="flex flex-col p-6 md:p-12"><div className="lg:hidden"><Logo /></div><div className="m-auto w-full max-w-md py-14"><div className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">{signup ? 'Start your workspace' : 'Welcome back'}</div><h1 className="mt-3 font-display text-4xl font-semibold tracking-[-.05em]">{signup ? 'Let’s make room.' : 'Good to see you.'}</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">{signup ? 'Create your workspace and keep every conversation within reach.' : 'Sign in to pick up where the conversation left off.'}</p><div className="mt-8 space-y-4"><label className="block text-sm font-semibold">Email address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourcrew.co" className="mt-2 w-full rounded-xl border border-input bg-card px-4 py-3.5 text-sm outline-none focus:border-primary" data-testid="input-auth-email" /></label>{signup && <label className="block text-sm font-semibold">Your name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ari Mendoza" className="mt-2 w-full rounded-xl border border-input bg-card px-4 py-3.5 text-sm outline-none focus:border-primary" data-testid="input-auth-name" /></label>}<label className="block text-sm font-semibold">Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" className="mt-2 w-full rounded-xl border border-input bg-card px-4 py-3.5 text-sm outline-none focus:border-primary" data-testid="input-auth-password" /></label><button onClick={() => void submit()} className="w-full rounded-xl bg-primary px-4 py-3.5 text-sm font-extrabold text-primary-foreground disabled:opacity-50" disabled={!email.trim() || password.length < 6 || (signup && !name.trim())} data-testid="button-auth-submit">{signup ? 'Create workspace' : 'Continue to workspace'}</button>{!signup && <button onClick={() => void resetPassword()} className="w-full text-center text-xs font-semibold text-muted-foreground hover:text-primary" data-testid="button-forgot-password">Forgot password?</button>}{(message || error) && <p className={`rounded-xl border px-4 py-3 text-xs leading-5 ${error ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-primary/20 bg-primary/5 text-muted-foreground'}`} role="status">{message || error}</p>}</div><p className="mt-8 text-center text-sm text-muted-foreground">{signup ? 'Already have a workspace?' : 'New here?'} <Link href={signup ? '/login' : '/signup'} className="font-bold text-primary hover:underline" data-testid="link-auth-switch">{signup ? 'Sign in' : 'Create one'}</Link></p></div></div></div>;
}

export function DashboardPage() {
  const { data, isLoading, isError } = useGetDashboard(); const dashboard = data;
  return <AppShell><PageHeading eyebrow="Monday, in focus" title="Make today count." description="Your rooms, your signal, one place to pick it back up." action={<Link href="/meetings/new" className="flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-primary-foreground" data-testid="button-start-dashboard"><Plus size={16} /> Start a meeting</Link>} />{isLoading ? <DashboardSkeleton /> : isError ? <ErrorState /> : dashboard ? <><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['Meetings held', dashboard.totalMeetings, 'this workspace', 'text-foreground'], ['Live now', dashboard.liveMeetings, 'right now', 'text-primary'], ['AI summaries', dashboard.summaries, 'ready to revisit', 'text-accent'], ['Hours returned', dashboard.hoursSaved, 'back to the crew', 'text-chart-3']].map(([label, value, detail, color], i) => <div key={String(label)} className={`animate-rise-${Math.min(i + 1, 3)} rounded-2xl border border-border bg-card p-5`}><div className="font-mono-ui text-[10px] uppercase tracking-[.17em] text-muted-foreground">{label}</div><div className={`mt-4 font-display text-4xl font-semibold tracking-[-.04em] ${color}`}>{value}</div><div className="mt-1 text-xs text-muted-foreground">{detail}</div></div>)}</div><div className="mt-8 grid gap-8 xl:grid-cols-[1.35fr_.65fr]"><section className="rounded-2xl border border-border bg-card p-6"><div className="flex items-center justify-between"><div><div className="font-mono-ui text-[10px] uppercase tracking-[.17em] text-primary">The latest rooms</div><h2 className="mt-2 font-display text-2xl font-semibold">Recent meetings</h2></div><Link href="/history" className="flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-primary" data-testid="link-view-history">View history <ArrowUpRight size={14} /></Link></div><div className="mt-6">{dashboard.recent?.length ? dashboard.recent.slice(0, 5).map((m) => <MeetingRow key={m.id} meeting={m} />) : <EmptyState title="No rooms yet" detail="Start the first conversation and it’ll land here." action={<Link href="/meetings/new" className="inline-flex rounded-lg bg-primary px-4 py-2 text-xs font-extrabold text-primary-foreground" data-testid="button-start-empty">Start one</Link>} />}</div></section><section className="rounded-2xl border border-border bg-card p-6"><div className="font-mono-ui text-[10px] uppercase tracking-[.17em] text-accent">On deck</div><h2 className="mt-2 font-display text-2xl font-semibold">Upcoming</h2><div className="mt-6 space-y-4">{dashboard.upcoming?.length ? dashboard.upcoming.slice(0, 4).map((m) => <Link key={m.id} href={`/meetings/${m.id}`} className="block rounded-xl border border-border bg-background p-4 hover:border-accent/50" data-testid={`card-upcoming-${m.id}`}><div className="flex items-start justify-between gap-3"><div className="font-semibold">{m.title}</div><CalendarDays size={16} className="text-accent" /></div><div className="mt-2 text-xs text-muted-foreground">{formatDate(m.startedAt)} · {formatTime(m.startedAt)}</div></Link>) : <p className="text-sm leading-6 text-muted-foreground">Nothing scheduled. Keep the calendar honest.</p>}</div></section></div></> : null}</AppShell>;
}
function DashboardSkeleton() { return <div className="space-y-8"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32" />)}</div><div className="grid gap-8 xl:grid-cols-[1.35fr_.65fr]"><Skeleton className="h-96" /><Skeleton className="h-96" /></div></div>; }

export function MeetingsPage() {
  const [location, setLocation] = useLocation(); const [createOpen, setCreateOpen] = useState(location === '/meetings/new'); const [tab, setTab] = useState<'all' | 'live' | 'scheduled' | 'ended'>('all'); const query = useListMeetings(tab === 'all' ? undefined : { status: tab }); const join = useJoinMeeting(); const meetings = query.data ?? []; const tap = useTapEffect();
  return <AppShell><TapEffectsLayer effects={tap.effects} onDone={tap.remove} /><PageHeading eyebrow="Your rooms" title="Meetings" description="Start something new, jump into what’s live, or find the thread you lost." action={<button onClick={(e) => { tap.trigger(e); setCreateOpen(true); }} className="flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-primary-foreground" data-testid="button-start-meetings"><Plus size={16} /> Start a meeting</button>} /><div className="mb-6 flex flex-wrap gap-2">{(['all', 'live', 'scheduled', 'ended'] as const).map((value) => <button key={value} onClick={(e) => { tap.trigger(e); setTab(value); }} className={`rounded-lg px-3 py-2 font-mono-ui text-[10px] uppercase tracking-[.12em] ${tab === value ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:text-foreground'}`} data-testid={`button-filter-${value}`}>{value}</button>)}</div>{query.isLoading ? <div className="rounded-2xl border border-border bg-card p-6 space-y-5">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}</div> : query.isError ? <ErrorState /> : meetings.length ? <div className="rounded-2xl border border-border bg-card p-6">{meetings.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} onJoin={(id) => join.mutate({ meetingId: id }, { onSuccess: () => setLocation(`/meetings/${id}`) })} />)}</div> : <EmptyState title="The room is quiet." detail={tab === 'all' ? 'Start a meeting to give this workspace a little momentum.' : `No ${tab} meetings right now.`} action={<button onClick={(e) => { tap.trigger(e); setCreateOpen(true); }} className="rounded-lg bg-primary px-4 py-2 text-xs font-extrabold text-primary-foreground" data-testid="button-start-meetings-empty">Start a meeting</button>} />}<CreateMeeting open={createOpen} onClose={() => setCreateOpen(false)} /></AppShell>;
}

export function HistoryPage({ notesOnly = false }: { notesOnly?: boolean }) {
  const history = useListMeetingHistory();
  const [search, setSearch] = useState('');
  const meetings = (history.data ?? []).filter((m) => (!notesOnly || Boolean(m.notes)) && (!search || m.title.toLowerCase().includes(search.toLowerCase())));
  return (
    <AppShell>
      <PageHeading eyebrow={notesOnly ? 'Your second brain' : 'The archive'} title={notesOnly ? 'AI notes' : 'History'} description={notesOnly ? 'The useful parts of every conversation, kept close.' : 'Every room, decision, and next move in one durable trail.'} />
      <div className="mb-6 flex max-w-md items-center gap-3 rounded-xl border border-input bg-card px-4 py-3"><Search size={16} className="text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={notesOnly ? 'Find a note…' : 'Search meetings…'} className="w-full bg-transparent text-sm outline-none" data-testid={`input-search-${notesOnly ? 'notes' : 'history'}`} /></div>
      {history.isLoading ? <div className="rounded-2xl border border-border bg-card p-6 space-y-5">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div> : history.isError ? <ErrorState /> : meetings.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {meetings.map((meeting) => <Link key={meeting.id} href={`/history/${meeting.id}`} className="group rounded-2xl border border-border bg-card p-5 hover:-translate-y-0.5 hover:border-accent/50" data-testid={`card-history-${meeting.id}`}>
            <div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-xl bg-accent/15 text-accent"><Sparkles size={15} /></span><StatusPill status="ended" /></div><h3 className="mt-4 font-display text-xl font-semibold">{meeting.title}</h3>{notesOnly && meeting.notes && <p className="mt-2 line-clamp-2 text-sm leading-5 text-muted-foreground">{meeting.notes.summary}</p>}</div><ChevronRight size={17} className="mt-1 text-muted-foreground group-hover:text-accent" /></div>
            <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-xs text-muted-foreground"><span>{formatDate(meeting.endedAt)}</span><span className="flex items-center gap-1.5"><Users size={13} /> {meeting.participantCount}</span><span className={meeting.notes ? 'text-primary' : ''}>{meeting.notes ? 'Notes ready' : 'Transcript only'}</span></div>
          </Link>)}
        </div>
      ) : <EmptyState title="Nothing saved yet." detail="Finished meetings will become the memory your team can actually use." />}
    </AppShell>
  );
}

function RemoteVideo({
  stream,
  name,
  cameraOn,
  isMuted,
  role,
}: {
  stream?: MediaStream | null;
  name: string;
  cameraOn?: boolean;
  isMuted?: boolean;
  role?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      if (videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
      void videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  // Sync mute state to video element to avoid audio bleeding when muted
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = Boolean(isMuted);
    }
  }, [isMuted]);

  const hasVideo = Boolean(stream && cameraOn !== false && stream.getVideoTracks().some((t) => t.enabled));

  return (
    <div className="relative flex min-h-[160px] min-w-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border border-primary/20 bg-[#0c1424]">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className={`h-full w-full object-cover ${hasVideo ? '' : 'hidden'}`}
        data-testid="video-remote-preview"
      />
      {!hasVideo && (
        <div className="flex flex-col items-center gap-2 p-4 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-primary/20 font-display text-lg font-bold text-primary">
            {initials(name)}
          </div>
          <span className="font-mono-ui text-xs text-muted-foreground">{name} (Camera off)</span>
        </div>
      )}
      <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-lg bg-black/75 px-2.5 py-1 font-mono-ui text-xs text-white">
        <span className="font-semibold">{name}</span>
        {role === 'Host' && <span className="rounded bg-primary/30 px-1 py-0.2 text-[9px] font-bold text-primary">Host</span>}
        {isMuted && <MicOff size={12} className="text-destructive" />}
      </div>
    </div>
  );
}

function PreJoinScreen({
  meeting,
  initialName,
  onJoin,
}: {
  meeting: Meeting;
  initialName: string;
  onJoin: (settings: { displayName: string; camera: boolean; muted: boolean; stream: MediaStream | null }) => void;
}) {
  const [displayName, setDisplayName] = useState(initialName || 'Participant');
  const [camera, setCamera] = useState(true);
  const [muted, setMuted] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<{ title: string; detail: string; isPermission: boolean } | null>(null);
  const [barHeights, setBarHeights] = useState<number[]>(Array(16).fill(4));
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const tap = useTapEffect();

  useEffect(() => {
    if (initialName && initialName !== 'Participant') {
      setDisplayName(initialName);
    }
  }, [initialName]);

  // Bind local preview video element whenever stream or camera state updates
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.defaultMuted = true;
      videoRef.current.muted = true;
      videoRef.current.volume = 0;
      if (videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
      void videoRef.current.play().catch(() => {});
    }
  }, [stream, camera]);

  useEffect(() => {
    let cancelled = false;
    const startPreview = async () => {
      if (
        typeof window !== 'undefined' &&
        !window.isSecureContext &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1'
      ) {
        setMediaError({
          title: 'Secure Context (HTTPS) Required',
          detail: 'Camera and microphone access requires HTTPS or localhost. If connecting over LAN, use an HTTPS tunnel or configure browser secure origins.',
          isPermission: false,
        });
        return;
      }

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setMediaError({
          title: 'Media Controls Unsupported',
          detail: 'Camera and microphone controls are not supported in this browser.',
          isPermission: false,
        });
        return;
      }

      try {
        const result = await acquireLocalMediaStream();
        if (cancelled) {
          result.stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setStream(result.stream);
        setCamera(result.videoActive);
        setMuted(!result.audioActive);
        if (result.warning) {
          setMediaError({
            title: result.warning.title,
            detail: result.warning.detail,
            isPermission: false,
          });
        } else {
          setMediaError(null);
        }

        // Audio analyser for pre-join mic visualizer (isolated from speakers)
        try {
          const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          if (AudioContextClass) {
            const ctx = new AudioContextClass();
            audioCtxRef.current = ctx;
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 64;
            analyser.smoothingTimeConstant = 0.8;
            analyserRef.current = analyser;
            const audioTrack = result.stream.getAudioTracks()[0];
            if (audioTrack) {
              const audioOnlyStream = new MediaStream([audioTrack]);
              const source = ctx.createMediaStreamSource(audioOnlyStream);
              // Connect only to analyser, NEVER to ctx.destination (speakers)
              source.connect(analyser);
            }
            const data = new Uint8Array(analyser.frequencyBinCount);
            const draw = () => {
              if (cancelled) return;
              rafRef.current = requestAnimationFrame(draw);
              analyser.getByteFrequencyData(data);
              const step = Math.max(1, Math.floor(data.length / 16));
              const heights = Array.from({ length: 16 }, (_, i) => {
                let sum = 0;
                for (let j = 0; j < step; j++) sum += data[i * step + j] ?? 0;
                const avg = sum / step;
                return avg < 4 ? 4 : 4 + (avg / 255) * 36;
              });
              setBarHeights(heights);
            };
            draw();
          }
        } catch {}
      } catch (err) {
        console.error('[PreJoinScreen] Failed to acquire media stream:', err);
        setMediaError(getMediaErrorMessage(err));
      }
    };

    void startPreview();

    return () => {
      cancelled = true;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      safeCloseAudioContext(audioCtxRef, analyserRef);
    };
  }, []);

  const toggleCamera = () => {
    const next = !camera;
    stream?.getVideoTracks().forEach((t) => { t.enabled = next; });
    setCamera(next);
  };

  const toggleMic = () => {
    const next = !muted;
    stream?.getAudioTracks().forEach((t) => { t.enabled = !next; });
    setMuted(next);
  };

  const handleJoin = (e: React.MouseEvent) => {
    tap.trigger(e);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    safeCloseAudioContext(audioCtxRef, analyserRef);
    onJoin({
      displayName: displayName.trim() || 'Participant',
      camera,
      muted,
      stream,
    });
  };

  return (
    <AppShell>
      <TapEffectsLayer effects={tap.effects} onDone={tap.remove} />
      <div className="mx-auto max-w-xl py-6 md:py-10">
        <div className="rounded-3xl border border-primary/25 bg-card p-6 md:p-8">
          <div className="flex items-center gap-2">
            <StatusPill status={meeting.status} />
            <span className="font-mono-ui text-[10px] uppercase tracking-[.15em] text-muted-foreground">Pre-Join Setup</span>
          </div>

          <h1 className="mt-3 font-display text-2xl font-semibold tracking-[-.03em] md:text-3xl">
            {meeting.title}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Hosted by <strong className="text-foreground">{meeting.hostName}</strong>
          </p>

          {/* Camera Preview */}
          <div className="relative mt-6 flex h-60 w-full items-center justify-center overflow-hidden rounded-2xl border border-border bg-[#0e1628]">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className={`h-full w-full object-cover ${camera ? '' : 'hidden'}`}
              data-testid="video-prejoin-preview"
            />
            {!camera && (
              <div className="flex flex-col items-center gap-2">
                <div className="grid h-16 w-16 place-items-center rounded-full bg-primary/20 font-display text-xl font-bold text-primary">
                  {initials(displayName)}
                </div>
                <span className="font-mono-ui text-xs text-muted-foreground">Camera is turned off</span>
              </div>
            )}

            {/* In-video floating toggles */}
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5 rounded-lg bg-black/75 px-3 py-1.5 font-mono-ui text-xs text-white">
                <span>{displayName || 'You'}</span>
                {muted && <MicOff size={13} className="text-destructive" />}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={(e) => { tap.trigger(e); toggleMic(); }}
                  className={`grid h-9 w-9 place-items-center rounded-xl border font-bold ${
                    muted ? 'border-destructive bg-destructive/20 text-destructive' : 'border-white/20 bg-black/60 text-white hover:bg-black/80'
                  }`}
                  data-testid="button-prejoin-toggle-mic"
                >
                  {muted ? <MicOff size={15} /> : <Mic size={15} />}
                </button>
                <button
                  type="button"
                  onClick={(e) => { tap.trigger(e); toggleCamera(); }}
                  className={`grid h-9 w-9 place-items-center rounded-xl border font-bold ${
                    !camera ? 'border-destructive bg-destructive/20 text-destructive' : 'border-white/20 bg-black/60 text-white hover:bg-black/80'
                  }`}
                  data-testid="button-prejoin-toggle-camera"
                >
                  {camera ? <Video size={15} /> : <VideoOff size={15} />}
                </button>
              </div>
            </div>
          </div>

          {/* Audio Visualizer Level */}
          <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-background px-4 py-3">
            <div className="flex items-center gap-2 font-mono-ui text-xs text-muted-foreground">
              <Mic size={14} className={muted ? 'text-muted-foreground' : 'text-primary'} />
              <span>{muted ? 'Microphone muted' : 'Microphone level'}</span>
            </div>
            <div className="flex items-end gap-1">
              {barHeights.map((h, i) => (
                <span
                  key={i}
                  className={`w-1 rounded-full ${muted ? 'bg-muted-foreground/30' : 'bg-primary'}`}
                  style={{ height: muted ? 4 : h, minHeight: 4, transition: 'height 0.08s ease-out' }}
                />
              ))}
            </div>
          </div>

          {mediaError && (
            <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive">
              <div className="font-bold">{mediaError.title}</div>
              <div className="mt-1 leading-5 text-destructive/90">{mediaError.detail}</div>
            </div>
          )}

          {/* Display Name Input */}
          <div className="mt-5">
            <label className="block font-mono-ui text-xs font-semibold uppercase tracking-[.12em] text-muted-foreground">
              Your Display Name in this meeting
            </label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter your name…"
              className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-semibold outline-none focus:border-primary"
              data-testid="input-prejoin-name"
            />
          </div>

          {/* Join Button */}
          <button
            onClick={handleJoin}
            disabled={!displayName.trim()}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-4 text-sm font-extrabold text-primary-foreground shadow-lg shadow-primary/20 hover:opacity-90 disabled:opacity-50"
            data-testid="button-enter-meeting"
          >
            <Play size={16} fill="currentColor" />
            Join Meeting
          </button>
        </div>
      </div>
    </AppShell>
  );
}

export function MeetingDetailPage() {
  const { meetingId = '' } = useParams<{ meetingId: string }>();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const query = useGetMeeting(meetingId, { query: { queryKey: getGetMeetingQueryKey(meetingId), enabled: !!meetingId } });
  const join = useJoinMeeting();
  const end = useEndMeeting();
  const notes = useGenerateMeetingNotes();
  const append = useAppendTranscript();
  const profile = useGetProfile();
  const { user, loading: authLoading } = useAuth();

  const authenticatedName = profile.data?.name || user?.displayName || (user?.email ? user.email.split('@')[0] : 'Participant');
  const [displayName, setDisplayName] = useState(authenticatedName);
  const [hasJoined, setHasJoined] = useState(false);
  const [draft, setDraft] = useState('');
  const [muted, setMuted] = useState(false);
  const [camera, setCamera] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [interim, setInterim] = useState('');
  const [mediaError, setMediaError] = useState<{ title: string; detail: string; isPermission: boolean } | null>(null);
  const [speechError, setSpeechError] = useState('');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const shareStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const meetingIsLiveRef = useRef(false);
  const meeting = query.data;
  const isLive = meeting?.status === 'live';
  const isHost = meeting?.hostId === user?.uid;

  // Sync authenticated name when loaded
  useEffect(() => {
    if (authenticatedName && authenticatedName !== 'Participant' && (!displayName || displayName === 'Participant')) {
      setDisplayName(authenticatedName);
    }
  }, [authenticatedName]);

  // Audio visualizer state & refs
  const NUM_BARS = 20;
  const [barHeights, setBarHeights] = useState<number[]>(Array(NUM_BARS).fill(4));
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const triggerFileInputRef = useRef<(() => void) | null>(null);
  const [isWhiteboardOpen, setIsWhiteboardOpen] = useState(false);
  const tap = useTapEffect();

  const participantUid = useMemo(() => {
    if (user?.uid) return user.uid;
    if (typeof window !== 'undefined') {
      let gid = sessionStorage.getItem('genz_meet_guest_id');
      if (!gid) {
        gid = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        sessionStorage.setItem('genz_meet_guest_id', gid);
      }
      return gid;
    }
    return `guest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }, [user?.uid]);

  // Multi-user Mesh WebRTC Hook
  const { remoteParticipants, connectionStates } = useWebRTC({
    meetingId,
    userId: participantUid,
    userName: displayName || authenticatedName || 'Participant',
    localStream,
    isLive: Boolean(isLive && hasJoined),
    isMuted: muted,
    cameraOn: camera,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: getGetMeetingQueryKey(meetingId) });
    qc.invalidateQueries({ queryKey: getListMeetingsQueryKey() });
    qc.invalidateQueries({ queryKey: getListMeetingHistoryQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  };

  // Bind local preview video element whenever localStream or camera state updates
  useEffect(() => {
    if (videoRef.current && localStream) {
      videoRef.current.defaultMuted = true;
      videoRef.current.muted = true;
      videoRef.current.volume = 0;
      if (videoRef.current.srcObject !== localStream) {
        videoRef.current.srcObject = localStream;
      }
      void videoRef.current.play().catch(() => {});
    }
  }, [localStream, camera, hasJoined]);

  // When pre-join completes and user enters the meeting
  const handlePreJoinComplete = (settings: { displayName: string; camera: boolean; muted: boolean; stream: MediaStream | null }) => {
    setDisplayName(settings.displayName);
    setCamera(settings.camera);
    setMuted(settings.muted);
    setLocalStream(settings.stream);
    mediaStreamRef.current = settings.stream;
    setHasJoined(true);
    join.mutate({ meetingId }, { onSuccess: refresh });
  };

  // Live Room media lifecycle
  useEffect(() => {
    meetingIsLiveRef.current = Boolean(isLive && hasJoined);
    if (!isLive || !hasJoined) return;

    let cancelled = false;
    const initLiveMedia = async () => {
      if (
        typeof window !== 'undefined' &&
        !window.isSecureContext &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1'
      ) {
        setMediaError({
          title: 'Secure Context (HTTPS) Required',
          detail: 'Camera and microphone require HTTPS or localhost for remote browsers.',
          isPermission: false,
        });
        return;
      }

      let stream = mediaStreamRef.current;
      const hasLiveTrack = Boolean(stream && stream.getTracks().some((t) => t.readyState === 'live'));

      if (!hasLiveTrack) {
        try {
          const result = await acquireLocalMediaStream();
          if (cancelled) {
            result.stream.getTracks().forEach((t) => t.stop());
            return;
          }
          stream = result.stream;
          mediaStreamRef.current = stream;
          setLocalStream(stream);
          setCamera(result.videoActive);
          setMuted(!result.audioActive);
          if (result.warning) {
            setMediaError({
              title: result.warning.title,
              detail: result.warning.detail,
              isPermission: false,
            });
          } else {
            setMediaError(null);
          }
        } catch (err) {
          console.error('[LiveRoom] Failed to acquire media stream:', err);
          setMediaError(getMediaErrorMessage(err));
          return;
        }
      } else if (stream) {
        setLocalStream(stream);
      }

      // Explicitly mute local video element to guarantee zero local speaker feedback
      if (videoRef.current && stream) {
        videoRef.current.defaultMuted = true;
        videoRef.current.muted = true;
        videoRef.current.volume = 0;
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => {});
      }

      // Audio visualizer wiring (strictly sampled without speaker output)
      try {
        const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioContextClass && !audioCtxRef.current) {
          const ctx = new AudioContextClass();
          audioCtxRef.current = ctx;
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 64;
          analyser.smoothingTimeConstant = 0.8;
          analyserRef.current = analyser;
          const audioTrack = stream?.getAudioTracks()[0];
          if (audioTrack) {
            const audioOnlyStream = new MediaStream([audioTrack]);
            const source = ctx.createMediaStreamSource(audioOnlyStream);
            // Connect ONLY to analyser, NEVER to ctx.destination
            source.connect(analyser);
          }
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const IDLE_HEIGHTS = [4, 5, 4, 6, 5, 4, 5, 4, 6, 5, 4, 5, 4, 6, 5, 4, 5, 6, 4, 5];
          const drawFrame = () => {
            if (cancelled) return;
            rafRef.current = requestAnimationFrame(drawFrame);
            analyser.getByteFrequencyData(dataArray);
            const step = Math.max(1, Math.floor(dataArray.length / NUM_BARS));
            const heights = Array.from({ length: NUM_BARS }, (_, i) => {
              let sum = 0;
              for (let j = 0; j < step; j++) sum += (dataArray[i * step + j] ?? 0);
              const avg = sum / step;
              const idle = IDLE_HEIGHTS[i] ?? 4;
              return avg < 4 ? idle : idle + (avg / 255) * (90 - idle);
            });
            setBarHeights(heights);
          };
          drawFrame();
        }
      } catch {}

      // Live Speech recognition
      const SpeechRecognition = getSpeechRecognition();
      if (!SpeechRecognition) {
        setSpeechError('Live speech recognition is not supported in this browser.');
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.onresult = (event) => {
        let interimText = '';
        let finalText = '';
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const text = result[0]?.transcript ?? '';
          if (result.isFinal) {
            finalText += (finalText ? ' ' : '') + text.trim();
          } else {
            interimText += (interimText ? ' ' : '') + text.trim();
          }
        }
        if (interimText) {
          setInterim(interimText);
        }
        if (finalText) {
          setInterim('');
          const speakerName = displayName || authenticatedName || 'Participant';
          const optimisticEntry = {
            id: `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            speaker: speakerName,
            text: finalText,
            createdAt: new Date().toISOString(),
          };
          qc.setQueryData(getGetMeetingQueryKey(meetingId), (old: Meeting | undefined) => {
            if (!old) return old;
            return {
              ...old,
              transcript: [...(old.transcript ?? []), optimisticEntry],
            };
          });
          append.mutate(
            { meetingId, data: { speaker: speakerName, text: finalText } },
            { onSuccess: refresh }
          );
        }
      };
      recognition.onerror = (event) => {
        const err = event.error;
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          setSpeechError('Microphone permission was denied for live transcription.');
        } else if (err === 'audio-capture') {
          setSpeechError('Microphone hardware is busy or unavailable for transcription.');
        } else if (err === 'no-speech' || err === 'aborted') {
          // Normal silence or intentional stop - do not show error
        } else if (err === 'network') {
          console.warn('[SpeechRecognition] Network glitch, will resume automatically.');
        }
      };
      recognition.onend = () => {
        if (!cancelled && meetingIsLiveRef.current && !muted) {
          window.setTimeout(() => {
            if (!cancelled && meetingIsLiveRef.current && !muted) {
              try {
                recognition.start();
                setSpeechError('');
              } catch {}
            }
          }, 300);
        }
      };
      recognitionRef.current = recognition;
      window.setTimeout(() => {
        if (!cancelled && meetingIsLiveRef.current && !muted) {
          try {
            recognition.start();
            setSpeechError('');
          } catch {}
        }
      }, 300);
    };

    void initLiveMedia();

    return () => {
      cancelled = true;
      meetingIsLiveRef.current = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      safeCloseAudioContext(audioCtxRef, analyserRef);
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      shareStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      shareStreamRef.current = null;
      setLocalStream(null);
    };
  }, [isLive, hasJoined, meetingId]);

  if (query.isLoading || authLoading) return <AppShell><Skeleton className="h-[560px]" /></AppShell>;
  if (query.isError || !meeting) return <AppShell><ErrorState /></AppShell>;

  // Pre-join screen for live rooms before entering
  if (isLive && !hasJoined) {
    return <PreJoinScreen meeting={meeting} initialName={authenticatedName} onJoin={handlePreJoinComplete} />;
  }

  const toggleMic = async () => {
    const nextMuted = !muted;
    const currentAudioTracks = mediaStreamRef.current?.getAudioTracks() ?? [];
    if (!nextMuted && currentAudioTracks.length === 0) {
      try {
        const aStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
        const newTrack = aStream.getAudioTracks()[0];
        if (newTrack) {
          if (!mediaStreamRef.current) {
            mediaStreamRef.current = new MediaStream();
          }
          mediaStreamRef.current.addTrack(newTrack);
          setLocalStream(new MediaStream(mediaStreamRef.current.getTracks()));
          setMuted(false);
          setMediaError(null);
          try { recognitionRef.current?.start(); } catch {}
        }
      } catch (err) {
        console.error('[LiveRoom] Failed to acquire microphone on toggle:', err);
        setMediaError(getMediaErrorMessage(err));
      }
      return;
    }
    mediaStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
    setMuted(nextMuted);
    if (nextMuted) {
      setInterim('');
      try { recognitionRef.current?.stop(); } catch {}
    } else {
      try { recognitionRef.current?.start(); } catch {}
    }
  };

  const toggleCamera = async () => {
    const nextCamera = !camera;
    const currentVideoTracks = mediaStreamRef.current?.getVideoTracks() ?? [];
    if (nextCamera && currentVideoTracks.length === 0) {
      try {
        const vStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const newTrack = vStream.getVideoTracks()[0];
        if (newTrack) {
          if (!mediaStreamRef.current) {
            mediaStreamRef.current = new MediaStream();
          }
          mediaStreamRef.current.addTrack(newTrack);
          setLocalStream(new MediaStream(mediaStreamRef.current.getTracks()));
          setCamera(true);
          setMediaError(null);
        }
      } catch (err) {
        console.error('[LiveRoom] Failed to acquire camera on toggle:', err);
        setMediaError(getMediaErrorMessage(err));
      }
      return;
    }
    mediaStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = nextCamera; });
    setCamera(nextCamera);
  };

  const toggleScreenShare = async () => {
    if (sharing) {
      shareStreamRef.current?.getTracks().forEach((track) => track.stop());
      shareStreamRef.current = null;
      if (videoRef.current) {
        videoRef.current.defaultMuted = true;
        videoRef.current.muted = true;
        videoRef.current.volume = 0;
        videoRef.current.srcObject = mediaStreamRef.current;
      }
      if (mediaStreamRef.current) setLocalStream(mediaStreamRef.current);
      setSharing(false);
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMediaError({
        title: 'Screen Share Unsupported',
        detail: 'Screen sharing is not supported in this browser.',
        isPermission: false,
      });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      shareStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.defaultMuted = true;
        videoRef.current.muted = true;
        videoRef.current.volume = 0;
        videoRef.current.srcObject = stream;
      }
      setLocalStream(stream);
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        shareStreamRef.current = null;
        if (videoRef.current) {
          videoRef.current.defaultMuted = true;
          videoRef.current.muted = true;
          videoRef.current.volume = 0;
          videoRef.current.srcObject = mediaStreamRef.current;
        }
        if (mediaStreamRef.current) setLocalStream(mediaStreamRef.current);
        setSharing(false);
      });
      setSharing(true);
    } catch {
      setMediaError({
        title: 'Screen Share Cancelled',
        detail: 'Screen sharing was cancelled or unavailable.',
        isPermission: false,
      });
    }
  };

  const totalParticipantCount = Math.max(meeting.participantCount, remoteParticipants.length + 1);

  return (
    <AppShell>
      <TapEffectsLayer effects={tap.effects} onDone={tap.remove} />
      <div className="mb-6 flex items-center gap-3">
        <Link href={isLive ? '/meetings' : '/history'} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="link-back-detail">
          <ArrowLeft size={18} />
        </Link>
        <span className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-muted-foreground">
          {isLive ? 'LIVE MEETING' : 'Completed meeting'}
        </span>
        {isLive && (
          <span className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 font-mono-ui text-[10px] font-bold text-primary">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-primary" /> Mesh Room Active ({totalParticipantCount})
          </span>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_.6fr]">
        <section className={`min-h-[620px] rounded-3xl border p-5 md:p-7 ${isLive ? 'border-primary/25 bg-card' : 'border-border bg-card'}`}>
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <div className="flex items-center gap-2">
                <StatusPill status={meeting.status} />
                {isLive && <span className="font-mono-ui text-[10px] text-muted-foreground">room {meeting.id.slice(0, 6)}</span>}
              </div>
              <h1 className="mt-4 font-display text-3xl font-semibold tracking-[-.04em] md:text-4xl">{meeting.title}</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {isLive ? `Started ${formatTime(meeting.startedAt)}` : `Ended ${formatDate(meeting.endedAt)} at ${formatTime(meeting.endedAt)}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <AvatarStack names={[...meeting.participants.map((p) => p.name), ...remoteParticipants.map((p) => p.name)]} count={totalParticipantCount} />
              <span className="ml-1 text-xs text-muted-foreground">{totalParticipantCount} present</span>
            </div>
          </div>

          {isLive && (
            <div className="mt-7 grid gap-4 md:grid-cols-[1.1fr_.9fr]">
              {/* Audio Visualizer Panel */}
              <div className="relative flex min-h-[240px] flex-col justify-end overflow-hidden rounded-2xl border border-primary/20 bg-[#101a36] p-5">
                <div className="absolute inset-0 opacity-60" style={{ backgroundImage: 'radial-gradient(circle at 70% 20%, hsl(var(--accent)/.25), transparent 38%), radial-gradient(circle at 20% 90%, hsl(var(--primary)/.16), transparent 38%)' }} />
                <div className="relative flex items-end gap-1">
                  {barHeights.map((height, i) => (
                    <span key={i} className="w-full rounded-full bg-primary/60" style={{ height, minHeight: 4, transition: 'height 0.08s ease-out' }} />
                  ))}
                </div>
                <div className="relative mt-5 flex items-center justify-between">
                  <span className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.15em] text-primary">
                    <span className="live-dot h-1.5 w-1.5 rounded-full bg-primary" /> LIVE · Your voice capture
                  </span>
                  <span className="font-mono-ui text-[10px] text-muted-foreground">{meeting.transcript.length} lines captured</span>
                </div>
              </div>

              {/* Video Grid & Controls */}
              <div className="flex flex-col justify-between rounded-2xl border border-border bg-background p-5">
                <div>
                  <div className="flex items-center justify-between font-mono-ui text-[10px] uppercase tracking-[.15em] text-muted-foreground">
                    <span>Participants ({totalParticipantCount})</span>
                    <span className="text-primary">{remoteParticipants.length > 0 ? `${remoteParticipants.length + 1} connected` : 'Solo in room'}</span>
                  </div>

                  {/* Multi-Participant Grid */}
                  <div className={`mt-4 grid gap-3 ${remoteParticipants.length === 0 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
                    {/* User's Local Video Card */}
                    <div className="relative flex min-h-[160px] items-center justify-center overflow-hidden rounded-2xl border border-border bg-[#0c1424]">
                      <video ref={videoRef} autoPlay muted playsInline className={`h-full w-full object-cover ${camera ? '' : 'hidden'}`} data-testid="video-local-preview" />
                      {!camera && (
                        <div className="flex flex-col items-center gap-2 p-4 text-center">
                          <div className="grid h-14 w-14 place-items-center rounded-full bg-accent/20 font-display text-lg font-bold text-accent">
                            {initials(displayName)}
                          </div>
                          <span className="font-mono-ui text-xs text-muted-foreground">Camera off</span>
                        </div>
                      )}
                      <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-lg bg-black/75 px-2.5 py-1 font-mono-ui text-xs text-white">
                        <span>{displayName} (You)</span>
                        {isHost && <span className="rounded bg-primary/30 px-1 py-0.2 text-[9px] font-bold text-primary">Host</span>}
                        {muted && <MicOff size={12} className="text-destructive" />}
                      </div>
                    </div>

                    {/* Remote Participants' Video Cards */}
                    {remoteParticipants.map((p) => (
                      <RemoteVideo key={p.id} stream={p.stream} name={p.name} cameraOn={p.cameraOn} isMuted={p.isMuted} role={p.id === meeting.hostId ? 'Host' : 'Participant'} />
                    ))}
                  </div>
                </div>

                {/* Meeting Controls */}
                <div className="mt-4 flex flex-wrap gap-2 pt-3 border-t border-border">
                  <button onClick={(e) => { tap.trigger(e); toggleMic(); }} className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold ${muted ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-border bg-card'}`} data-testid="button-toggle-mic">
                    {muted ? <MicOff size={14} /> : <Mic size={14} />}
                    {muted ? 'Unmute' : 'Mute'}
                  </button>
                  <button onClick={(e) => { tap.trigger(e); toggleCamera(); }} className={`rounded-xl border px-3 text-xs font-bold ${!camera ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-border bg-card'}`} data-testid="button-toggle-camera">
                    {camera ? <Video size={14} /> : <VideoOff size={14} />}
                  </button>
                  <button onClick={(e) => { tap.trigger(e); void toggleScreenShare(); }} className={`rounded-xl border px-3 text-xs font-bold ${sharing ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card'}`} data-testid="button-toggle-screen-share">
                    <Share2 size={14} />
                  </button>
                  <button onClick={(e) => { tap.trigger(e); triggerFileInputRef.current?.(); }} className="rounded-xl border border-border bg-card px-3 text-xs font-bold hover:border-primary/40 hover:text-primary transition-colors" data-testid="button-meeting-share-file" title="Share a file with the room">
                    <Paperclip size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      tap.trigger(e);
                      setIsWhiteboardOpen((prev) => !prev);
                    }}
                    className={`flex items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition-colors ${
                      isWhiteboardOpen
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-card hover:border-primary/40 hover:text-primary'
                    }`}
                    data-testid="button-meeting-whiteboard"
                    title="Open Collaborative Whiteboard"
                  >
                    <Pen size={14} />
                    <span className="hidden sm:inline">Whiteboard</span>
                  </button>
                </div>
                {mediaError && (
                  <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                    <div className="font-bold">{mediaError.title}</div>
                    <div className="mt-1 leading-5 text-destructive/90">{mediaError.detail}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Transcript Panel */}
          <div className="mt-7 border-t border-border pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                <Radio size={13} className={isLive ? 'text-primary' : ''} /> LIVE TRANSCRIPT
              </div>
              {isLive && (
                <span className="text-xs text-primary font-medium">
                  {speechError ? 'Manual transcript active' : 'Live transcription is active. You can also continue with manual transcript lines.'}
                </span>
              )}
            </div>
            {speechError && <p className="mt-3 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs leading-5 text-muted-foreground">{speechError}</p>}
            <div className="mt-4 max-h-[290px] space-y-4 overflow-y-auto pr-2">
              {meeting.transcript.length ? meeting.transcript.map((line) => (
                <div key={line.id} className="flex gap-3" data-testid={`text-transcript-${line.id}`}>
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-secondary font-mono-ui text-[9px] font-bold text-secondary-foreground">
                    {initials(line.speaker)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 text-xs font-bold">
                      {line.speaker}
                      <span className="font-mono-ui text-[9px] font-normal text-muted-foreground">{formatTime(line.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{line.text}</p>
                  </div>
                </div>
              )) : <p className="py-8 text-center text-sm text-muted-foreground">Transcript lines will appear here as participants talk.</p>}
              {interim && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm italic text-primary" data-testid="text-live-interim">
                  {displayName}: {interim}
                </div>
              )}
            </div>

            {isLive && (
              <div className="mt-4 flex gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && draft.trim()) {
                      append.mutate({ meetingId, data: { speaker: displayName || authenticatedName, text: draft.trim() } }, { onSuccess: () => { setDraft(''); refresh(); } });
                    }
                  }}
                  placeholder="Add a transcript line manually…"
                  className="min-w-0 flex-1 rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary"
                  data-testid="input-transcript"
                />
                <button
                  disabled={!draft.trim() || append.isPending}
                  onClick={(e) => {
                    tap.trigger(e);
                    append.mutate({ meetingId, data: { speaker: displayName || authenticatedName, text: draft.trim() } }, { onSuccess: () => { setDraft(''); refresh(); } });
                  }}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50"
                  data-testid="button-send-transcript"
                >
                  <Send size={16} />
                </button>
              </div>
            )}
          </div>

          {/* Meeting Exit Buttons */}
          {isLive && (
            <div className="mt-7 flex flex-wrap justify-end gap-3 border-t border-border pt-5">
              <button onClick={(e) => { tap.trigger(e); setLocation('/meetings'); }} className="rounded-xl border border-border px-4 py-3 text-xs font-bold" data-testid="button-leave-meeting">
                Leave meeting
              </button>
              <button onClick={(e) => { tap.trigger(e); join.mutate({ meetingId }, { onSuccess: refresh }); }} className="rounded-xl border border-border px-4 py-3 text-xs font-bold" data-testid="button-rejoin">
                Refresh room
              </button>
              {isHost && (
                <button onClick={(e) => { tap.trigger(e); if (window.confirm('End this meeting and generate notes for all participants?')) end.mutate({ meetingId }, { onSuccess: refresh }); }} className="rounded-xl bg-destructive px-4 py-3 text-xs font-extrabold text-destructive-foreground" data-testid="button-end-meeting">
                  {end.isPending ? 'Wrapping up…' : 'End meeting'}
                </button>
              )}
            </div>
          )}
        </section>

        {/* Sidebar Aside */}
        <aside className="space-y-6">
          {isLive && <ShareLinkCard meetingId={meetingId} tap={tap} />}
          <SharedFilesCard
            meetingId={meetingId}
            currentUserId={participantUid}
            currentUserName={displayName || authenticatedName}
            isLive={isLive}
            onTriggerFileInputRef={triggerFileInputRef}
          />
          {meeting.notes ? (
            <NotesPanel meeting={meeting} />
          ) : (
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent/15 text-accent">
                <Sparkles size={19} />
              </div>
              <h2 className="mt-5 font-display text-2xl font-semibold">Notes are waiting.</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Turn the transcript into the short version you'll actually read.</p>
              <button disabled={notes.isPending || isLive} onClick={(e) => { tap.trigger(e); notes.mutate({ meetingId }, { onSuccess: refresh }); }} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-extrabold text-accent-foreground disabled:opacity-50" data-testid="button-generate-notes">
                <Sparkles size={15} />
                {notes.isPending ? 'Thinking…' : isLive ? 'Available after the meeting' : 'Generate AI notes'}
              </button>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-muted-foreground">Room details</div>
            <div className="mt-5 space-y-4 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Hosted by</span>
                <span className="font-semibold">{meeting.hostName}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Created</span>
                <span className="font-semibold">{formatDate(meeting.createdAt)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Participants</span>
                <span className="font-semibold">{totalParticipantCount}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <WhiteboardModal
        meetingId={meetingId}
        userId={participantUid}
        userName={displayName || authenticatedName || 'Participant'}
        isOpen={isWhiteboardOpen}
        onClose={() => setIsWhiteboardOpen(false)}
        collaboratorsCount={totalParticipantCount}
      />
    </AppShell>
  );
}

function NotesPanel({ meeting }: { meeting: Meeting }) {
  const notes = meeting.notes;
  if (!notes) return null;
  const sections = [['Key points', notes.keyPoints], ['Decisions', notes.decisions], ['Action items', notes.actionItems], ['Next steps', notes.followUps]] as const;
  return (
    <div className="rounded-2xl border border-accent/25 bg-accent/[.06] p-6">
      <div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.16em] text-accent">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent/15"><Sparkles size={15} /></span> AI notes
      </div>
      <h2 className="mt-4 font-display text-2xl font-semibold">The short version.</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{notes.summary}</p>
      <div className="mt-6 space-y-5">
        {sections.map(([label, list]) => (
          <div key={label}>
            <div className="font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">{label}</div>
            <ul className="mt-2 space-y-2">
              {list.length ? list.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm leading-5">
                  <Check size={14} className="mt-0.5 shrink-0 text-primary" />{item}
                </li>
              )) : <li className="text-sm text-muted-foreground">Nothing explicit was captured.</li>}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-6 border-t border-accent/20 pt-4 font-mono-ui text-[9px] uppercase tracking-[.12em] text-muted-foreground">
        Generated {formatDate(notes.generatedAt)}
      </div>
    </div>
  );
}

function ShareLinkCard({ meetingId, tap }: { meetingId: string; tap: ReturnType<typeof useTapEffect> }) {
  const [copied, setCopied] = useState(false);
  const shareLink = typeof window !== 'undefined' ? `${window.location.origin}/meetings/${meetingId}` : `/meetings/${meetingId}`;

  const copy = async (e: React.MouseEvent) => {
    tap.trigger(e);
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = shareLink;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  };

  return (
    <div className="rounded-2xl border border-primary/25 bg-primary/[.04] p-5">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/15 text-primary"><Share2 size={15} /></span>
        <span className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-primary">Meeting link</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">Share this link with participants to join the meeting room.</p>
      
      <div className="mt-3 space-y-2.5">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono-ui text-[11px] text-muted-foreground" title={shareLink}>{shareLink}</span>
        </div>
        <button
          onClick={copy}
          data-testid="button-copy-link"
          className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold transition-colors ${
            copied
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-border bg-background hover:border-primary/40 hover:text-primary'
          }`}
        >
          {copied ? <><Check size={13} /> Link copied!</> : <><Copy size={13} /> Copy link</>}
        </button>
      </div>
    </div>
  );
}