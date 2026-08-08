import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateMeeting, useEndMeeting, useGenerateMeetingNotes, useGetDashboard, useGetMeeting, useJoinMeeting, useListMeetingHistory, useListMeetings, useAppendTranscript, getGetDashboardQueryKey, getGetMeetingQueryKey, getListMeetingsQueryKey, getListMeetingHistoryQueryKey } from '@workspace/api-client-react';
import type { Meeting } from '@workspace/api-client-react';
import { ArrowLeft, ArrowUpRight, CalendarDays, Check, ChevronRight, CircleHelp, Copy, FileText, Filter, Mic, MicOff, MoreHorizontal, Play, Plus, Radio, RefreshCw, Search, Send, Share2, Sparkles, Timer, Users, Video, VideoOff } from 'lucide-react';
import { AppShell, AvatarStack, EmptyState, ErrorState, formatDate, formatTime, Logo, PageHeading, Skeleton, StatusPill } from '@/components/meet-shell';

function initials(name: string) { return name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase(); }

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
  return <Link href={`/meetings/${meeting.id}`} className="group flex flex-col gap-4 border-b border-border/70 py-5 first:pt-0 last:border-0 sm:flex-row sm:items-center sm:justify-between" data-testid={`row-meeting-${meeting.id}`}>
    <div className="flex min-w-0 items-center gap-4"><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl font-display text-sm font-bold ${meeting.status === 'live' ? 'bg-primary/15 text-primary' : 'bg-secondary text-secondary-foreground'}`}>{initials(meeting.title)}</div><div className="min-w-0"><div className="truncate font-semibold group-hover:text-primary">{meeting.title}</div><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><StatusPill status={meeting.status} /><span>{meeting.status === 'ended' ? formatDate(meeting.endedAt) : formatTime(meeting.startedAt)}</span><span className="text-foreground/30">·</span><span>{meeting.participantCount} people</span></div></div></div>
    <div className="flex items-center gap-3 pl-[60px] sm:pl-0">{meeting.status === 'live' && onJoin && <button onClick={(e) => { e.preventDefault(); onJoin(meeting.id); }} className="rounded-lg bg-primary px-3 py-2 text-xs font-extrabold text-primary-foreground" data-testid={`button-join-${meeting.id}`}>Join live</button>}<ChevronRight size={17} className="text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" /></div>
  </Link>;
}

function CreateMeeting({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, setLocation] = useLocation(); const [title, setTitle] = useState(''); const [hostName, setHostName] = useState('Ari Mendoza'); const create = useCreateMeeting(); const qc = useQueryClient();
  if (!open) return null;
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-background/80 p-5 backdrop-blur-md"><div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-2xl md:p-8"><div className="flex items-start justify-between"><div><div className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">New room</div><h2 className="mt-2 font-display text-3xl font-semibold">What are we making space for?</h2></div><button onClick={onClose} className="text-muted-foreground" data-testid="button-close-create">×</button></div><div className="mt-7 space-y-4"><label className="block text-sm font-semibold">Meeting name<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Friday ship check" className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary" data-testid="input-meeting-title" /></label><label className="block text-sm font-semibold">Your name<input value={hostName} onChange={(e) => setHostName(e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary" data-testid="input-host-name" /></label></div><div className="mt-7 flex justify-end gap-3"><button onClick={onClose} className="rounded-xl px-4 py-3 text-sm font-bold text-muted-foreground" data-testid="button-cancel-create">Cancel</button><button disabled={!title.trim() || create.isPending} onClick={() => create.mutate({ data: { title: title.trim(), hostName } }, { onSuccess: (meeting) => { qc.invalidateQueries({ queryKey: getListMeetingsQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); setLocation(`/meetings/${meeting.id}`); } })} className="rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-primary-foreground disabled:opacity-50" data-testid="button-create-meeting">{create.isPending ? 'Opening room…' : 'Open live room'}</button></div></div></div>;
}

export function Landing() {
  const [, setLocation] = useLocation(); const [createOpen, setCreateOpen] = useState(false);
  return <div className="min-h-[100dvh] overflow-hidden bg-background text-foreground"><header className="relative z-10 flex items-center justify-between px-6 py-6 md:px-12"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground"><span className="h-3 w-3 rounded-full border-2 border-current" /></span><span className="font-display text-lg font-semibold">gen z meet<span className="text-primary">.</span></span></div><div className="flex items-center gap-3"><Link href="/login" className="rounded-lg px-3 py-2 text-sm font-bold text-muted-foreground hover:text-foreground" data-testid="link-login">Sign in</Link><Link href="/signup" className="rounded-lg border border-border px-4 py-2 text-sm font-bold hover:bg-muted" data-testid="link-signup">Get started</Link></div></header><main className="relative mx-auto max-w-7xl px-6 pb-20 pt-16 md:px-12 md:pt-24"><div className="pointer-events-none absolute -right-28 top-10 h-[480px] w-[480px] rounded-full bg-accent/10 blur-[100px]" /><div className="pointer-events-none absolute -left-40 top-60 h-[360px] w-[360px] rounded-full bg-primary/10 blur-[100px]" /><div className="relative grid items-center gap-16 lg:grid-cols-[1.05fr_.95fr]"><div className="animate-rise"><div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/5 px-3 py-1.5 font-mono-ui text-[10px] uppercase tracking-[.16em] text-primary"><span className="live-dot h-1.5 w-1.5 rounded-full bg-primary" /> For teams who actually talk</div><h1 className="max-w-3xl font-display text-[clamp(3.5rem,8vw,7.8rem)] font-semibold leading-[.9] tracking-[-.07em]">Make the room.<br /><span className="text-primary">Keep the signal.</span></h1><p className="mt-8 max-w-lg text-base leading-7 text-muted-foreground md:text-lg">A meeting workspace that stays present while you talk — then hands you the good stuff when it’s over.</p><div className="mt-9 flex flex-wrap gap-3"><button onClick={() => setCreateOpen(true)} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-sm font-extrabold text-primary-foreground shadow-[0_10px_35px_hsl(var(--primary)/.14)] hover:brightness-105" data-testid="button-start-landing"><Play size={16} fill="currentColor" /> Start a meeting</button><button onClick={() => setLocation('/dashboard')} className="flex items-center gap-2 rounded-xl border border-border px-5 py-3.5 text-sm font-bold hover:bg-muted" data-testid="button-see-workspace">See the workspace <ArrowUpRight size={16} /></button></div></div><div className="animate-rise-2 relative"><div className="surface-grid relative rounded-[2rem] border border-border bg-card p-4 shadow-2xl md:p-6"><div className="flex items-center justify-between border-b border-border pb-4"><div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.18em] text-muted-foreground"><span className="h-2 w-2 rounded-full bg-primary" /> live room</div><span className="font-mono-ui text-[10px] text-muted-foreground">00:42:18</span></div><div className="grid grid-cols-2 gap-3 pt-4"><div className="col-span-2 rounded-2xl border border-primary/25 bg-primary/[.06] p-5"><div className="flex items-center justify-between"><span className="font-display text-xl font-semibold">Friday ship check</span><StatusPill status="live" /></div><div className="mt-5 flex items-center gap-4"><AvatarStack names={['Ari Mendoza', 'Mika Chen', 'Noah Park', 'Sol Reed']} count={5} /><span className="text-xs text-muted-foreground">5 in the room</span></div></div><div className="rounded-2xl border border-border bg-background p-4"><div className="font-mono-ui text-[10px] uppercase tracking-widest text-muted-foreground">Transcript</div><div className="mt-4 flex items-end gap-1.5">{[34, 58, 42, 70, 48, 82, 56, 72, 38, 64, 46, 74].map((h, i) => <span key={i} className="w-full rounded-full bg-primary/70" style={{ height: `${h / 2}px` }} />)}</div><p className="mt-3 text-xs text-muted-foreground">Capturing as you speak</p></div><div className="rounded-2xl border border-border bg-background p-4"><div className="font-mono-ui text-[10px] uppercase tracking-widest text-muted-foreground">Afterwards</div><div className="mt-4 text-2xl font-semibold text-accent">4<span className="ml-1 text-xs font-normal text-muted-foreground">next moves</span></div><p className="mt-3 text-xs text-muted-foreground">AI notes, no busywork</p></div></div></div><div className="absolute -bottom-5 -left-7 rounded-xl border border-border bg-secondary px-4 py-3 shadow-xl"><div className="flex items-center gap-2 font-mono-ui text-[10px] text-secondary-foreground"><Sparkles size={13} /> notes are ready</div></div></div></div><div className="mt-24 grid gap-4 border-t border-border pt-8 md:grid-cols-3"><div><div className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">01 / while you talk</div><p className="mt-3 max-w-xs font-display text-xl font-semibold">Live transcript, zero tab juggling.</p></div><div><div className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-accent">02 / when you leave</div><p className="mt-3 max-w-xs font-display text-xl font-semibold">The decisions and next moves, already sorted.</p></div><div><div className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">03 / whenever you need</div><p className="mt-3 max-w-xs font-display text-xl font-semibold">A memory for every room you’ve been in.</p></div></div></main><CreateMeeting open={createOpen} onClose={() => setCreateOpen(false)} /></div>;
}

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const [, setLocation] = useLocation(); const [email, setEmail] = useState(''); const signup = mode === 'signup';
  return <div className="grid min-h-[100dvh] lg:grid-cols-[.9fr_1.1fr]"><div className="surface-grid hidden flex-col justify-between bg-sidebar p-12 lg:flex"><Logo /><div><div className="font-mono-ui text-xs uppercase tracking-[.2em] text-primary">A workspace for the in-between</div><div className="mt-5 max-w-md font-display text-5xl font-semibold leading-[.98] tracking-[-.05em]">The best ideas usually happen after someone says, “wait, what if…”</div></div><div className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-muted-foreground">gen z meet / 2025</div></div><div className="flex flex-col p-6 md:p-12"><div className="lg:hidden"><Logo /></div><div className="m-auto w-full max-w-md py-14"><div className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">{signup ? 'Start your workspace' : 'Welcome back'}</div><h1 className="mt-3 font-display text-4xl font-semibold tracking-[-.05em]">{signup ? 'Let’s make room.' : 'Good to see you.'}</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">{signup ? 'Set up a demo workspace for your crew. No ceremony required.' : 'Sign in to pick up where the conversation left off.'}</p><div className="mt-8 space-y-4"><label className="block text-sm font-semibold">Email address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourcrew.co" className="mt-2 w-full rounded-xl border border-input bg-card px-4 py-3.5 text-sm outline-none focus:border-primary" data-testid="input-auth-email" /></label>{signup && <label className="block text-sm font-semibold">Your name<input placeholder="Ari Mendoza" className="mt-2 w-full rounded-xl border border-input bg-card px-4 py-3.5 text-sm outline-none focus:border-primary" data-testid="input-auth-name" /></label>}<button onClick={() => setLocation('/dashboard')} className="w-full rounded-xl bg-primary px-4 py-3.5 text-sm font-extrabold text-primary-foreground disabled:opacity-50" disabled={!email} data-testid="button-auth-submit">{signup ? 'Create demo workspace' : 'Continue to workspace'}</button><div className="flex items-center gap-3 py-2 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" /> demo handoff <span className="h-px flex-1 bg-border" /></div><button onClick={() => setLocation('/dashboard')} className="w-full rounded-xl border border-border bg-card px-4 py-3.5 text-sm font-bold hover:bg-muted" data-testid="button-demo-access">Use demo workspace</button></div><p className="mt-8 text-center text-sm text-muted-foreground">{signup ? 'Already have a workspace?' : 'New here?'} <Link href={signup ? '/login' : '/signup'} className="font-bold text-primary hover:underline" data-testid="link-auth-switch">{signup ? 'Sign in' : 'Create one'}</Link></p></div></div></div>;
}

export function DashboardPage() {
  const { data, isLoading, isError } = useGetDashboard(); const dashboard = data;
  return <AppShell><PageHeading eyebrow="Monday, in focus" title="Make today count." description="Your rooms, your signal, one place to pick it back up." action={<Link href="/meetings/new" className="flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-primary-foreground" data-testid="button-start-dashboard"><Plus size={16} /> Start a meeting</Link>} />{isLoading ? <DashboardSkeleton /> : isError ? <ErrorState /> : dashboard ? <><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['Meetings held', dashboard.totalMeetings, 'this workspace', 'text-foreground'], ['Live now', dashboard.liveMeetings, 'right now', 'text-primary'], ['AI summaries', dashboard.summaries, 'ready to revisit', 'text-accent'], ['Hours returned', dashboard.hoursSaved, 'back to the crew', 'text-chart-3']].map(([label, value, detail, color], i) => <div key={String(label)} className={`animate-rise-${Math.min(i + 1, 3)} rounded-2xl border border-border bg-card p-5`}><div className="font-mono-ui text-[10px] uppercase tracking-[.17em] text-muted-foreground">{label}</div><div className={`mt-4 font-display text-4xl font-semibold tracking-[-.04em] ${color}`}>{value}</div><div className="mt-1 text-xs text-muted-foreground">{detail}</div></div>)}</div><div className="mt-8 grid gap-8 xl:grid-cols-[1.35fr_.65fr]"><section className="rounded-2xl border border-border bg-card p-6"><div className="flex items-center justify-between"><div><div className="font-mono-ui text-[10px] uppercase tracking-[.17em] text-primary">The latest rooms</div><h2 className="mt-2 font-display text-2xl font-semibold">Recent meetings</h2></div><Link href="/history" className="flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-primary" data-testid="link-view-history">View history <ArrowUpRight size={14} /></Link></div><div className="mt-6">{dashboard.recent?.length ? dashboard.recent.slice(0, 5).map((m) => <MeetingRow key={m.id} meeting={m} />) : <EmptyState title="No rooms yet" detail="Start the first conversation and it’ll land here." action={<Link href="/meetings/new" className="inline-flex rounded-lg bg-primary px-4 py-2 text-xs font-extrabold text-primary-foreground" data-testid="button-start-empty">Start one</Link>} />}</div></section><section className="rounded-2xl border border-border bg-card p-6"><div className="font-mono-ui text-[10px] uppercase tracking-[.17em] text-accent">On deck</div><h2 className="mt-2 font-display text-2xl font-semibold">Upcoming</h2><div className="mt-6 space-y-4">{dashboard.upcoming?.length ? dashboard.upcoming.slice(0, 4).map((m) => <Link key={m.id} href={`/meetings/${m.id}`} className="block rounded-xl border border-border bg-background p-4 hover:border-accent/50" data-testid={`card-upcoming-${m.id}`}><div className="flex items-start justify-between gap-3"><div className="font-semibold">{m.title}</div><CalendarDays size={16} className="text-accent" /></div><div className="mt-2 text-xs text-muted-foreground">{formatDate(m.startedAt)} · {formatTime(m.startedAt)}</div></Link>) : <p className="text-sm leading-6 text-muted-foreground">Nothing scheduled. Keep the calendar honest.</p>}</div></section></div></> : null}</AppShell>;
}
function DashboardSkeleton() { return <div className="space-y-8"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32" />)}</div><div className="grid gap-8 xl:grid-cols-[1.35fr_.65fr]"><Skeleton className="h-96" /><Skeleton className="h-96" /></div></div>; }

export function MeetingsPage() {
  const [location, setLocation] = useLocation(); const [createOpen, setCreateOpen] = useState(location === '/meetings/new'); const [tab, setTab] = useState<'all' | 'live' | 'scheduled' | 'ended'>('all'); const query = useListMeetings(tab === 'all' ? undefined : { status: tab }); const join = useJoinMeeting(); const meetings = query.data ?? [];
  return <AppShell><PageHeading eyebrow="Your rooms" title="Meetings" description="Start something new, jump into what’s live, or find the thread you lost." action={<button onClick={() => setCreateOpen(true)} className="flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-primary-foreground" data-testid="button-start-meetings"><Plus size={16} /> Start a meeting</button>} /><div className="mb-6 flex flex-wrap gap-2">{(['all', 'live', 'scheduled', 'ended'] as const).map((value) => <button key={value} onClick={() => setTab(value)} className={`rounded-lg px-3 py-2 font-mono-ui text-[10px] uppercase tracking-[.12em] ${tab === value ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:text-foreground'}`} data-testid={`button-filter-${value}`}>{value}</button>)}</div>{query.isLoading ? <div className="rounded-2xl border border-border bg-card p-6 space-y-5">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}</div> : query.isError ? <ErrorState /> : meetings.length ? <div className="rounded-2xl border border-border bg-card p-6">{meetings.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} onJoin={(id) => join.mutate({ meetingId: id }, { onSuccess: () => setLocation(`/meetings/${id}`) })} />)}</div> : <EmptyState title="The room is quiet." detail={tab === 'all' ? 'Start a meeting to give this workspace a little momentum.' : `No ${tab} meetings right now.`} action={<button onClick={() => setCreateOpen(true)} className="rounded-lg bg-primary px-4 py-2 text-xs font-extrabold text-primary-foreground" data-testid="button-start-meetings-empty">Start a meeting</button>} />}<CreateMeeting open={createOpen} onClose={() => setCreateOpen(false)} /></AppShell>;
}

export function HistoryPage({ notesOnly = false }: { notesOnly?: boolean }) {
  const history = useListMeetingHistory();
  const [search, setSearch] = useState('');
  const meetings = (history.data ?? []).filter((m) => !search || m.title.toLowerCase().includes(search.toLowerCase()));
  return (
    <AppShell>
      <PageHeading eyebrow={notesOnly ? 'Your second brain' : 'The archive'} title={notesOnly ? 'AI notes' : 'History'} description={notesOnly ? 'The useful parts of every conversation, kept close.' : 'Every room, decision, and next move in one durable trail.'} />
      <div className="mb-6 flex max-w-md items-center gap-3 rounded-xl border border-input bg-card px-4 py-3"><Search size={16} className="text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={notesOnly ? 'Find a note…' : 'Search meetings…'} className="w-full bg-transparent text-sm outline-none" data-testid={`input-search-${notesOnly ? 'notes' : 'history'}`} /></div>
      {history.isLoading ? <div className="rounded-2xl border border-border bg-card p-6 space-y-5">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div> : history.isError ? <ErrorState /> : meetings.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {meetings.map((meeting) => <Link key={meeting.id} href={`/history/${meeting.id}`} className="group rounded-2xl border border-border bg-card p-5 hover:-translate-y-0.5 hover:border-accent/50" data-testid={`card-history-${meeting.id}`}>
            <div className="flex items-start justify-between gap-4"><div><StatusPill status="ended" /><h3 className="mt-4 font-display text-xl font-semibold">{meeting.title}</h3></div><ChevronRight size={17} className="mt-1 text-muted-foreground group-hover:text-accent" /></div>
            <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-xs text-muted-foreground"><span>{formatDate(meeting.endedAt)}</span><span className="flex items-center gap-1.5"><Users size={13} /> {meeting.participantCount}</span><span className={meeting.notes ? 'text-primary' : ''}>{meeting.notes ? 'Notes ready' : 'Transcript only'}</span></div>
          </Link>)}
        </div>
      ) : <EmptyState title="Nothing saved yet." detail="Finished meetings will become the memory your team can actually use." />}
    </AppShell>
  );
}

export function MeetingDetailPage() {
  const { meetingId = '' } = useParams<{ meetingId: string }>(); const [, setLocation] = useLocation(); const qc = useQueryClient(); const query = useGetMeeting(meetingId, { query: { queryKey: getGetMeetingQueryKey(meetingId), enabled: !!meetingId } }); const join = useJoinMeeting(); const end = useEndMeeting(); const notes = useGenerateMeetingNotes(); const append = useAppendTranscript(); const [draft, setDraft] = useState(''); const [speaker, setSpeaker] = useState('Ari Mendoza'); const [muted, setMuted] = useState(false); const [camera, setCamera] = useState(true); const [sharing, setSharing] = useState(false); const [interim, setInterim] = useState(''); const [mediaError, setMediaError] = useState(''); const [speechError, setSpeechError] = useState(''); const videoRef = useRef<HTMLVideoElement>(null); const mediaStreamRef = useRef<MediaStream | null>(null); const shareStreamRef = useRef<MediaStream | null>(null); const recognitionRef = useRef<SpeechRecognitionLike | null>(null); const meetingIsLiveRef = useRef(false); const meeting = query.data;
  useEffect(() => {
    const isLive = meeting?.status === 'live';
    meetingIsLiveRef.current = isLive;
    if (!isLive) return;

    let cancelled = false;
    const startDevices = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMediaError('Camera and microphone controls are unavailable in this browser.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        mediaStreamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        const SpeechRecognition = getSpeechRecognition();
        if (!SpeechRecognition) {
          setSpeechError('Live transcription is unavailable in this browser. You can still add transcript lines manually.');
          return;
        }
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        recognition.onresult = (event) => {
          let finalText = '';
          let interimText = '';
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];
            if (result.isFinal) finalText += result[0].transcript;
            else interimText += result[0].transcript;
          }
          setInterim(interimText);
          if (finalText.trim()) {
            append.mutate({ meetingId, data: { speaker, text: finalText.trim() } }, { onSuccess: refresh });
          }
        };
        recognition.onerror = (event) => {
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            setSpeechError('Microphone permission was denied for live transcription. Your meeting is still active.');
          } else {
            setSpeechError('Live transcription paused. You can continue with manual transcript lines.');
          }
        };
        recognition.onend = () => {
          recognitionRef.current = null;
        };
        recognitionRef.current = recognition;
        try {
          recognition.start();
        } catch {
          setSpeechError('Live transcription could not start in this browser. You can continue with manual transcript lines.');
        }
      } catch {
        setMediaError('Microphone or camera permission was denied. You can still use the meeting and add transcript lines manually.');
      }
    };
    void startDevices();
    return () => {
      cancelled = true;
      meetingIsLiveRef.current = false;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      shareStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      shareStreamRef.current = null;
    };
  }, [meeting?.status, meetingId]);
  const refresh = () => { qc.invalidateQueries({ queryKey: getGetMeetingQueryKey(meetingId) }); qc.invalidateQueries({ queryKey: getListMeetingsQueryKey() }); qc.invalidateQueries({ queryKey: getListMeetingHistoryQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); };
  if (query.isLoading) return <AppShell><Skeleton className="h-[560px]" /></AppShell>; if (query.isError || !meeting) return <AppShell><ErrorState /></AppShell>;
  const isLive = meeting.status === 'live';
  const toggleMic = () => {
    const nextMuted = !muted;
    mediaStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
    setMuted(nextMuted);
  };
  const toggleCamera = () => {
    const nextCamera = !camera;
    mediaStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = nextCamera; });
    setCamera(nextCamera);
  };
  const toggleScreenShare = async () => {
    if (sharing) {
      shareStreamRef.current?.getTracks().forEach((track) => track.stop());
      shareStreamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = mediaStreamRef.current;
      setSharing(false);
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMediaError('Screen sharing is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      shareStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        shareStreamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = mediaStreamRef.current;
        setSharing(false);
      });
      setSharing(true);
    } catch {
      setMediaError('Screen sharing was cancelled or unavailable.');
    }
  };
  return <AppShell><div className="mb-6 flex items-center gap-3"><Link href={isLive ? '/meetings' : '/history'} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="link-back-detail"><ArrowLeft size={18} /></Link><span className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-muted-foreground">{isLive ? 'LIVE MEETING' : 'Completed meeting'}</span></div><div className="grid gap-6 xl:grid-cols-[1.4fr_.6fr]"><section className={`min-h-[620px] rounded-3xl border p-5 md:p-7 ${isLive ? 'border-primary/25 bg-card' : 'border-border bg-card'}`}><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><div className="flex items-center gap-2"><StatusPill status={meeting.status} />{isLive && <span className="font-mono-ui text-[10px] text-muted-foreground">room {meeting.id.slice(0, 6)}</span>}</div><h1 className="mt-4 font-display text-3xl font-semibold tracking-[-.04em] md:text-4xl">{meeting.title}</h1><p className="mt-2 text-sm text-muted-foreground">{isLive ? `Started ${formatTime(meeting.startedAt)}` : `Ended ${formatDate(meeting.endedAt)} at ${formatTime(meeting.endedAt)}`}</p></div><div className="flex items-center gap-2"><AvatarStack names={meeting.participants.map((p) => p.name)} count={meeting.participantCount} /><span className="ml-1 text-xs text-muted-foreground">{meeting.participantCount} present</span></div></div>{isLive && <div className="mt-7 grid gap-4 md:grid-cols-[1.2fr_.8fr]"><div className="relative flex min-h-[230px] flex-col justify-end overflow-hidden rounded-2xl border border-primary/20 bg-[#101a36] p-5"><div className="absolute inset-0 opacity-60" style={{ backgroundImage: 'radial-gradient(circle at 70% 20%, hsl(var(--accent)/.25), transparent 38%), radial-gradient(circle at 20% 90%, hsl(var(--primary)/.16), transparent 38%)' }} /><div className="relative flex items-end gap-1">{[28, 38, 46, 35, 54, 72, 43, 66, 52, 86, 62, 48, 76, 58, 42, 68, 90, 55, 44, 60].map((height, i) => <span key={i} className="w-full rounded-full bg-primary/60" style={{ height }} />)}</div><div className="relative mt-5 flex items-center justify-between"><span className="font-mono-ui text-[10px] uppercase tracking-[.15em] text-primary">Listening in real time</span><span className="font-mono-ui text-[10px] text-muted-foreground">{meeting.transcript.length} lines captured</span></div></div><div className="rounded-2xl border border-border bg-background p-5"><div className="font-mono-ui text-[10px] uppercase tracking-[.15em] text-muted-foreground">Your setup</div><div className="relative mt-5 flex h-32 items-center justify-center overflow-hidden rounded-xl bg-secondary/60"><video ref={videoRef} autoPlay muted playsInline className={`h-full w-full object-cover ${camera ? '' : 'hidden'}`} data-testid="video-local-preview" />{!camera && <div className="grid h-14 w-14 place-items-center rounded-full bg-accent/20 font-display text-lg font-bold text-accent">AM</div>} </div><div className="mt-4 flex flex-wrap gap-2"><button onClick={toggleMic} className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold ${muted ? 'border-destructive/40 text-destructive' : 'border-border'}`} data-testid="button-toggle-mic">{muted ? <MicOff size={14} /> : <Mic size={14} />}{muted ? 'Unmute' : 'Mute'}</button><button onClick={toggleCamera} className="rounded-lg border border-border px-3 text-xs font-bold" data-testid="button-toggle-camera">{camera ? <Video size={14} /> : <VideoOff size={14} />}</button><button onClick={() => void toggleScreenShare()} className={`rounded-lg border px-3 text-xs font-bold ${sharing ? 'border-primary text-primary' : 'border-border'}`} data-testid="button-toggle-screen-share"><Share2 size={14} /></button></div>{mediaError && <p className="mt-3 text-xs leading-5 text-destructive">{mediaError}</p>}</div></div>}<div className="mt-7 border-t border-border pt-6"><div className="flex items-center justify-between"><div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.16em] text-muted-foreground"><Radio size={13} className={isLive ? 'text-primary' : ''} /> LIVE TRANSCRIPT</div>{isLive && <span className="text-xs text-primary">{speechError ? 'Manual capture' : 'Auto-capturing'}</span>}</div>{speechError && <p className="mt-3 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs leading-5 text-muted-foreground">{speechError}</p>}<div className="mt-4 max-h-[290px] space-y-4 overflow-y-auto pr-2">{meeting.transcript.length ? meeting.transcript.map((line) => <div key={line.id} className="flex gap-3" data-testid={`text-transcript-${line.id}`}><div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-secondary font-mono-ui text-[9px] font-bold text-secondary-foreground">{initials(line.speaker)}</div><div><div className="flex items-center gap-2 text-xs font-bold">{line.speaker}<span className="font-mono-ui text-[9px] font-normal text-muted-foreground">{formatTime(line.createdAt)}</span></div><p className="mt-1 text-sm leading-6 text-muted-foreground">{line.text}</p></div></div>) : <p className="py-8 text-center text-sm text-muted-foreground">Transcript lines will appear here as people talk.</p>}{interim && <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm italic text-primary" data-testid="text-live-interim">{speaker}: {interim}</div>}</div>{isLive && <div className="mt-4 flex gap-2"><input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { append.mutate({ meetingId, data: { speaker, text: draft.trim() } }, { onSuccess: () => { setDraft(''); refresh(); } }); } }} placeholder="Add a transcript line manually…" className="min-w-0 flex-1 rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary" data-testid="input-transcript" /><button disabled={!draft.trim() || append.isPending} onClick={() => append.mutate({ meetingId, data: { speaker, text: draft.trim() } }, { onSuccess: () => { setDraft(''); refresh(); } })} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50" data-testid="button-send-transcript"><Send size={16} /></button></div>}</div>{isLive && <div className="mt-7 flex flex-wrap justify-end gap-3 border-t border-border pt-5"><button onClick={() => setLocation('/meetings')} className="rounded-xl border border-border px-4 py-3 text-xs font-bold" data-testid="button-leave-meeting">Leave meeting</button><button onClick={() => join.mutate({ meetingId }, { onSuccess: refresh })} className="rounded-xl border border-border px-4 py-3 text-xs font-bold" data-testid="button-rejoin">Refresh room</button><button onClick={() => { if (window.confirm('End this meeting and generate notes?')) end.mutate({ meetingId }, { onSuccess: refresh }); }} className="rounded-xl bg-destructive px-4 py-3 text-xs font-extrabold text-destructive-foreground" data-testid="button-end-meeting">{end.isPending ? 'Wrapping up…' : 'End meeting'}</button></div>}</section><aside className="space-y-6">{meeting.notes ? <NotesPanel meeting={meeting} /> : <div className="rounded-2xl border border-border bg-card p-6"><div className="grid h-10 w-10 place-items-center rounded-xl bg-accent/15 text-accent"><Sparkles size={19} /></div><h2 className="mt-5 font-display text-2xl font-semibold">Notes are waiting.</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Turn the transcript into the short version you’ll actually read.</p><button disabled={notes.isPending || isLive} onClick={() => notes.mutate({ meetingId }, { onSuccess: refresh })} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-extrabold text-accent-foreground disabled:opacity-50" data-testid="button-generate-notes"><Sparkles size={15} />{notes.isPending ? 'Thinking…' : isLive ? 'Available after the meeting' : 'Generate AI notes'}</button></div>}<div className="rounded-2xl border border-border bg-card p-6"><div className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-muted-foreground">Room details</div><div className="mt-5 space-y-4 text-sm"><div className="flex justify-between gap-4"><span className="text-muted-foreground">Hosted by</span><span className="font-semibold">{meeting.hostName}</span></div><div className="flex justify-between gap-4"><span className="text-muted-foreground">Created</span><span className="font-semibold">{formatDate(meeting.createdAt)}</span></div><div className="flex justify-between gap-4"><span className="text-muted-foreground">Participants</span><span className="font-semibold">{meeting.participantCount}</span></div></div></div></aside></div></AppShell>;
}

function NotesPanel({ meeting }: { meeting: Meeting }) { const notes = meeting.notes; if (!notes) return null; return <div className="rounded-2xl border border-accent/25 bg-accent/[.06] p-6"><div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.16em] text-accent"><Sparkles size={13} /> AI notes</div><h2 className="mt-4 font-display text-2xl font-semibold">The short version.</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{notes.summary}</p><div className="mt-6 space-y-5">{[['Key points', notes.keyPoints], ['Decisions', notes.decisions], ['Next moves', notes.actionItems]].map(([label, list]) => <div key={String(label)}><div className="font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">{label}</div><ul className="mt-2 space-y-2">{(list as string[]).map((item, i) => <li key={i} className="flex gap-2 text-sm leading-5"><Check size={14} className="mt-0.5 shrink-0 text-primary" />{item}</li>)}</ul></div>)}</div><div className="mt-6 border-t border-accent/20 pt-4 font-mono-ui text-[9px] uppercase tracking-[.12em] text-muted-foreground">Generated {formatDate(notes.generatedAt)}</div></div>; }