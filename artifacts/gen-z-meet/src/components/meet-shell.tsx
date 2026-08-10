import { type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { CalendarDays, ChevronRight, Clock3, Command, FileText, LayoutDashboard, LifeBuoy, ListVideo, LogOut, Menu, Plus, Settings, Sparkles, UserRound, Video, X } from 'lucide-react';
import { useState } from 'react';
import { signOut } from 'firebase/auth';
import { useGetProfile } from '@workspace/api-client-react';
import { useAuth } from '@/lib/auth-context';
import { auth } from '@/lib/firebase';

const nav = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/meetings', label: 'Meetings', icon: Video },
  { href: '/history', label: 'History', icon: Clock3 },
  { href: '/ai-notes', label: 'AI notes', icon: Sparkles },
];

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-3" data-testid="link-brand">
      <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_0_26px_hsl(var(--primary)/.2)]">
        <span className="h-3 w-3 rounded-full border-2 border-current" />
        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
      </span>
      {!compact && <span className="font-display text-lg font-semibold tracking-tight text-foreground">gen z meet<span className="text-primary">.</span></span>}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();
  const profile = useGetProfile();
  const displayName = profile.data?.name || user?.displayName || user?.email?.split('@')[0] || 'Your workspace';
  const initials = displayName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const current = nav.find((item) => location.startsWith(item.href));
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[252px] flex-col border-r border-sidebar-border bg-sidebar px-5 py-6 transition-transform md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between">
          <Logo />
          <button className="rounded-lg p-2 text-muted-foreground md:hidden" onClick={() => setMobileOpen(false)} data-testid="button-close-menu"><X size={18} /></button>
        </div>
        <div className="mt-11 px-2 font-mono-ui text-[10px] uppercase tracking-[.22em] text-muted-foreground">Workspace</div>
        <nav className="mt-3 space-y-1">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = current?.href === href;
            return <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-white/[.04] hover:text-foreground'}`} data-testid={`link-nav-${label.toLowerCase().replace(' ', '-')}`}>
              <Icon size={17} strokeWidth={active ? 2.4 : 1.8} /><span>{label}</span>{active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
            </Link>;
          })}
        </nav>
        <div className="mt-10 px-2 font-mono-ui text-[10px] uppercase tracking-[.22em] text-muted-foreground">Personal</div>
        <nav className="mt-3 space-y-1">
          <Link href="/profile" onClick={() => setMobileOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${location === '/profile' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-white/[.04]'}`} data-testid="link-nav-profile"><UserRound size={17} /> Profile</Link>
          <Link href="/settings" onClick={() => setMobileOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${location === '/settings' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-white/[.04]'}`} data-testid="link-nav-settings"><Settings size={17} /> Settings</Link>
        </nav>
        <div className="mt-auto rounded-2xl border border-sidebar-border bg-white/[.025] p-4">
          <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-full bg-accent/20 font-display text-sm text-accent">{initials}</div><div><div className="text-sm font-bold">{displayName}</div><div className="font-mono-ui text-[10px] text-muted-foreground">{profile.data?.role || 'your workspace'}</div></div></div>
          <button onClick={() => void signOut(auth)} className="mt-4 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground" data-testid="button-sign-out"><LogOut size={14} /> Sign out</button>
        </div>
      </aside>
      {mobileOpen && <button className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" data-testid="button-overlay-menu" />}
      <div className="md:pl-[252px]">
        <header className="sticky top-0 z-30 flex h-[74px] items-center justify-between border-b border-border/70 bg-background/90 px-5 backdrop-blur-xl md:px-10">
          <div className="flex items-center gap-3"><button className="rounded-lg p-2 text-muted-foreground md:hidden" onClick={() => setMobileOpen(true)} data-testid="button-open-menu"><Menu size={21} /></button><div className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">{current?.label ?? 'Workspace'}</div></div>
          <div className="flex items-center gap-2"><button className="hidden items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 font-mono-ui text-[10px] text-muted-foreground sm:flex" data-testid="button-command-menu"><Command size={13} /> K <span className="text-foreground/40">search</span></button><Link href="/meetings/new" className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-extrabold text-primary-foreground hover:brightness-105" data-testid="button-start-meeting-header"><Plus size={14} /> Start meeting</Link></div>
        </header>
        <main className="mx-auto max-w-[1440px] px-5 py-8 md:px-10 md:py-10">{children}</main>
      </div>
    </div>
  );
}

export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><div className="font-mono-ui text-[10px] uppercase tracking-[.24em] text-primary">{eyebrow}</div><h1 className="mt-2 font-display text-4xl font-semibold tracking-[-.04em] text-foreground md:text-5xl">{title}</h1>{description && <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>}</div>{action}</div>;
}

export function Skeleton({ className = '' }: { className?: string }) { return <div className={`animate-pulse rounded-lg bg-muted/60 ${className}`} />; }
export function ErrorState({ message = 'The workspace could not load right now.' }: { message?: string }) { return <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center"><div className="font-display text-xl font-semibold">A small signal got lost.</div><p className="mt-2 text-sm text-muted-foreground">{message}</p><button onClick={() => window.location.reload()} className="mt-5 rounded-lg border border-border bg-card px-4 py-2 text-sm font-bold hover:bg-muted" data-testid="button-retry">Try again</button></div>; }
export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) { return <div className="surface-grid rounded-2xl border border-border p-10 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary"><ListVideo size={21} /></div><h3 className="mt-4 font-display text-xl font-semibold">{title}</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{detail}</p>{action && <div className="mt-5">{action}</div>}</div>; }
export function StatusPill({ status }: { status: string }) { const live = status === 'live'; return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono-ui text-[10px] uppercase tracking-[.12em] ${live ? 'bg-primary/10 text-primary' : status === 'scheduled' ? 'bg-accent/10 text-accent' : 'bg-muted text-muted-foreground'}`}><span className={`h-1.5 w-1.5 rounded-full ${live ? 'live-dot bg-primary' : status === 'scheduled' ? 'bg-accent' : 'bg-muted-foreground'}`} />{status}</span>; }
export function AvatarStack({ names, count }: { names: string[]; count?: number }) { return <div className="flex items-center">{names.slice(0, 4).map((name, i) => <div key={`${name}-${i}`} className="grid h-7 w-7 -mr-1 place-items-center rounded-full border-2 border-card bg-secondary font-display text-[10px] font-bold text-secondary-foreground" title={name}>{name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</div>)}{count && count > names.length && <div className="grid h-7 w-7 place-items-center rounded-full border-2 border-card bg-muted font-mono-ui text-[9px] text-muted-foreground">+{count - names.length}</div>}</div>; }
export const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : '—';
export const formatTime = (value?: string | null) => value ? new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '—';