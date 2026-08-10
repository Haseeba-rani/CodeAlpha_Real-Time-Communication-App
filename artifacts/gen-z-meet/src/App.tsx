import { type ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { AuthPage, DashboardPage, HistoryPage, Landing, MeetingDetailPage, MeetingsPage } from '@/pages/meet-pages';
import { useGetProfile, useUpdateProfile, getGetProfileQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { auth } from '@/lib/firebase';
import { getStoredProfile, saveStoredProfile } from '@/lib/firestore';
import { signOut } from 'firebase/auth';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();
const initials = (name: string) => name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();

function Home() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">
          Replit Agent is building...
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Your app will appear here once it's ready.
        </p>
      </div>
    </div>
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/login"><AuthPage mode="login" /></Route>
        <Route path="/signup"><AuthPage mode="signup" /></Route>
        <Route path="/dashboard"><ProtectedRoute><DashboardPage /></ProtectedRoute></Route>
        <Route path="/meetings/new"><ProtectedRoute><MeetingsPage /></ProtectedRoute></Route>
        <Route path="/meetings/:meetingId"><ProtectedRoute><MeetingDetailPage /></ProtectedRoute></Route>
        <Route path="/meetings"><ProtectedRoute><MeetingsPage /></ProtectedRoute></Route>
        <Route path="/history/:meetingId"><ProtectedRoute><MeetingDetailPage /></ProtectedRoute></Route>
        <Route path="/history"><ProtectedRoute><HistoryPage /></ProtectedRoute></Route>
        <Route path="/ai-notes"><ProtectedRoute><HistoryPage notesOnly /></ProtectedRoute></Route>
        <Route path="/profile"><ProtectedRoute><ProfilePage /></ProtectedRoute></Route>
        <Route path="/settings"><ProtectedRoute><SettingsPage /></ProtectedRoute></Route>
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const { user, loading } = useAuth();
  useEffect(() => {
    if (!loading && !user) {
      setLocation('/login');
    }
  }, [loading, setLocation, user]);
  if (loading) return <div className="min-h-[100dvh] bg-background" />;
  return user ? <>{children}</> : null;
}

function ProfilePage() {
  const { user } = useAuth();
  const profile = useGetProfile();
  const update = useUpdateProfile();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', bio: '', timezone: '', language: '', role: '' });
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!user) return;
    void getStoredProfile(user.uid).then((stored) => {
      const source = stored ?? profile.data;
      if (source) setForm({
        name: source.name,
        bio: source.bio,
        timezone: source.timezone,
        language: source.language,
        role: source.role,
      });
    });
  }, [profile.data, user]);
  const setField = (field: keyof typeof form, value: string) => {
    setSaved(false);
    setForm((current) => ({ ...current, [field]: value }));
  };
  const save = async () => {
    if (!user) return;
    setSaved(false);
    const stored = {
      name: form.name.trim(),
      bio: form.bio.trim(),
      timezone: form.timezone,
      language: form.language,
      role: form.role.trim(),
      email: user.email ?? profile.data?.email ?? '',
    };
    try {
      await saveStoredProfile(user.uid, stored);
      const next = await update.mutateAsync({ data: stored });
      qc.setQueryData(getGetProfileQueryKey(), next);
      setSaved(true);
    } catch {
      qc.setQueryData(getGetProfileQueryKey(), {
        ...(profile.data ?? {
          userId: user.uid,
          email: stored.email,
          updatedAt: new Date().toISOString(),
        }),
        ...stored,
        userId: user.uid,
        updatedAt: new Date().toISOString(),
      });
      setSaved(true);
    }
  };
  if (profile.isLoading) return <div className="min-h-[100dvh] bg-background p-6 text-foreground md:p-12"><div className="mx-auto max-w-2xl"><div className="animate-pulse rounded-3xl bg-card p-12" /></div></div>;
  return <div className="min-h-[100dvh] bg-background p-6 text-foreground md:p-12"><div className="mx-auto max-w-3xl"><div className="flex items-center justify-between"><a href="/dashboard" className="font-display text-xl font-semibold">gen z meet<span className="text-primary">.</span></a><a href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-profile-back">Back to workspace</a></div><div className="mt-16"><div className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">Personal</div><h1 className="mt-3 font-display text-5xl font-semibold tracking-[-.05em]">Your signal.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">This profile follows you through every room. Save it once and your name stays in the workspace.</p><div className="mt-10 rounded-3xl border border-border bg-card p-7 md:p-9"><div className="flex items-center gap-4"><div className="grid h-16 w-16 place-items-center rounded-full bg-accent/20 font-display text-xl font-bold text-accent">{initials(form.name || 'Ari Mendoza')}</div><div><div className="text-lg font-bold">{form.name || 'Your name'}</div><div className="text-sm text-muted-foreground">{profile.data?.email}</div></div></div><div className="mt-8 grid gap-5 sm:grid-cols-2"><label className="text-sm font-semibold">Display name<input value={form.name} onChange={(e) => setField('name', e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary" data-testid="input-profile-name" /></label><label className="text-sm font-semibold">Role<input value={form.role} onChange={(e) => setField('role', e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary" data-testid="input-profile-role" /></label><label className="text-sm font-semibold sm:col-span-2">Bio<textarea value={form.bio} onChange={(e) => setField('bio', e.target.value)} rows={3} className="mt-2 w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary" data-testid="input-profile-bio" /></label><label className="text-sm font-semibold">Timezone<select value={form.timezone} onChange={(e) => setField('timezone', e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary" data-testid="select-profile-timezone"><option value="America/Los_Angeles">Pacific Time</option><option value="America/Denver">Mountain Time</option><option value="America/Chicago">Central Time</option><option value="America/New_York">Eastern Time</option><option value="UTC">UTC</option></select></label><label className="text-sm font-semibold">Language<select value={form.language} onChange={(e) => setField('language', e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary" data-testid="select-profile-language"><option>English</option><option>Spanish</option><option>French</option><option>German</option></select></label></div><div className="mt-7 flex flex-wrap items-center gap-4"><button disabled={!form.name.trim() || update.isPending} className="rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-primary-foreground disabled:opacity-50" onClick={save} data-testid="button-save-profile">{update.isPending ? 'Saving…' : 'Save changes'}</button>{saved && <span className="text-sm font-semibold text-primary" role="status">Saved. Your workspace is up to date.</span>}{update.isError && <span className="text-sm text-destructive" role="alert">Couldn’t save your profile. Try again.</span>}</div></div></div></div></div>;
}

function SettingsPage() {
  return <div className="min-h-[100dvh] bg-background p-6 text-foreground md:p-12"><div className="mx-auto max-w-2xl"><div className="flex items-center justify-between"><a href="/dashboard" className="font-display text-xl font-semibold">gen z meet<span className="text-primary">.</span></a><a href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-settings-back">Back to workspace</a></div><div className="mt-20"><div className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-accent">Workspace settings</div><h1 className="mt-3 font-display text-5xl font-semibold tracking-[-.05em]">Make it yours.</h1><div className="mt-10 space-y-3">{[['Transcript capture', 'Capture every spoken word while a room is live.'], ['AI notes after meetings', 'Generate a useful recap when a room ends.'], ['Weekly room digest', 'A Monday nudge with the rooms worth revisiting.']].map(([title, detail], i) => <div key={title} className="flex items-center justify-between rounded-2xl border border-border bg-card p-5"><div><div className="font-semibold">{title}</div><div className="mt-1 text-sm text-muted-foreground">{detail}</div></div><button className={`relative h-7 w-12 rounded-full ${i < 2 ? 'bg-primary' : 'bg-muted'}`} data-testid={`button-toggle-setting-${i}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-background transition-transform ${i < 2 ? 'left-6' : 'left-1'}`} /></button></div>)}</div></div></div></div>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
