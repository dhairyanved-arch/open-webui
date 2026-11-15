import * as React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Backdrop } from '@/components/fx/primitives';
import { AppSidebar } from './AppSidebar';
import { TickerTape } from './TickerTape';
import { MODULES } from './nav';

function Clock() {
	const [now, setNow] = React.useState(() => new Date());
	React.useEffect(() => {
		const id = window.setInterval(() => setNow(new Date()), 1000);
		return () => window.clearInterval(id);
	}, []);
	return (
		<time className="num hidden text-[11px] text-muted-foreground sm:block" dateTime={now.toISOString()}>
			{now.toLocaleTimeString('en-GB', { hour12: false })}
		</time>
	);
}

function TopBar() {
	const location = useLocation();
	const current = MODULES.find((m) => location.pathname.startsWith(m.path));
	return (
		<div className="relative z-20 flex h-12 shrink-0 items-center gap-3 border-b border-white/[0.07] bg-background/50 px-3 backdrop-blur-xl">
			<SidebarTrigger />
			<div className="hidden items-center gap-2 text-[11px] whitespace-nowrap md:flex">
				<span className="text-muted-foreground">Terminal</span>
				<span className="text-white/20">/</span>
				<span className="font-medium text-foreground">{current?.label ?? 'Home'}</span>
			</div>
			<div className="mx-1 hidden h-4 w-px bg-white/10 md:block" />
			<TickerTape />
			<div className="flex shrink-0 items-center gap-3">
				<div className="flex items-center gap-1.5 rounded-full border border-bull/25 bg-bull/[0.07] px-2 py-0.5">
					<span className="size-1.5 animate-pulse-dot rounded-full bg-bull shadow-[0_0_8px_var(--bull)]" />
					<span className="num text-[10px] tracking-widest text-bull">SIM FEED</span>
				</div>
				<Clock />
			</div>
		</div>
	);
}

function RouteFallback() {
	return (
		<div className="flex h-full items-center justify-center">
			<div className="kicker animate-pulse">Loading module…</div>
		</div>
	);
}

export function AppShell() {
	const location = useLocation();
	return (
		<TooltipProvider delayDuration={150}>
			<Backdrop />
			<SidebarProvider>
				<AppSidebar />
				<SidebarInset>
					<TopBar />
					<div key={location.pathname} className="min-h-0 flex-1 animate-rise">
						<React.Suspense fallback={<RouteFallback />}>
							<Outlet />
						</React.Suspense>
					</div>
				</SidebarInset>
			</SidebarProvider>
		</TooltipProvider>
	);
}
