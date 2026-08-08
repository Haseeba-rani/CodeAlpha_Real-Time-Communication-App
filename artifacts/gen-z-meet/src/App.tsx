import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { AuthPage, DashboardPage, HistoryPage, Landing, MeetingDetailPage, MeetingsPage } from '@/pages/meet-pages';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

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
        <Route path="/dashboard" component={DashboardPage} />
        <Route path="/meetings/new" component={MeetingsPage} />
        <Route path="/meetings/:meetingId" component={MeetingDetailPage} />
        <Route path="/meetings" component={MeetingsPage} />
        <Route path="/history/:meetingId" component={MeetingDetailPage} />
        <Route path="/history" component={() => <HistoryPage />} />
        <Route path="/ai-notes" component={() => <HistoryPage notesOnly />} />
        <Route path="/profile" component={ProfilePage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function ProfilePage() {
  return <div className="min-h-[100dvh] bg-background p-6 text-foreground md:p-12"><div className="mx-auto max-w-2xl"><div className="flex items-center justify-between"><a href="/dashboard" className="font-display text-xl font-semibold">gen z meet<span className="text-primary">.</span></a><a href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-profile-back">Back to workspace</a></div><div className="mt-20"><div className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">Personal</div><h1 className="mt-3 font-display text-5xl font-semibold tracking-[-.05em]">Your signal.</h1><div className="mt-10 rounded-3xl border border-border bg-card p-7"><div className="flex items-center gap-4"><div className="grid h-16 w-16 place-items-center rounded-full bg-accent/20 font-display text-xl font-bold text-accent">AM</div><div><div className="text-lg font-bold">Ari Mendoza</div><div className="text-sm text-muted-foreground">ari@yourcrew.co</div></div></div><div className="mt-8 grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">Display name<input defaultValue="Ari Mendoza" className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary" data-testid="input-profile-name" /></label><label className="text-sm font-semibold">Role<input defaultValue="Product lead" className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary" data-testid="input-profile-role" /></label></div><button className="mt-6 rounded-xl bg-primary px-4 py-3 text-sm font-extrabold text-primary-foreground" onClick={() => window.alert('Profile saved for this demo.')} data-testid="button-save-profile">Save profile</button></div></div></div></div>;
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
