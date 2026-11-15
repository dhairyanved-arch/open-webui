import { NavLink, useLocation } from 'react-router-dom';
import { Dices } from 'lucide-react';
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar
} from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMockData } from '@/context/MockDataContext';
import { cn } from '@/lib/utils';
import { MODULES } from './nav';

function BrandMark() {
	return (
		<div className="relative grid size-10 shrink-0 place-items-center rounded-xl border border-primary/30 bg-primary/10 shadow-[0_0_28px_-8px_var(--primary)]">
			<svg viewBox="0 0 32 32" className="size-6" aria-hidden>
				<path
					d="M5 24 L13 9 L18 17 L27 6"
					fill="none"
					stroke="var(--primary)"
					strokeWidth="2.4"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
				<circle cx="27" cy="6" r="2.4" fill="var(--accent)" />
			</svg>
		</div>
	);
}

export function AppSidebar() {
	const { state } = useSidebar();
	const { seed, reseed } = useMockData();
	const location = useLocation();
	const collapsed = state === 'collapsed';

	return (
		<Sidebar aria-label="Module navigation">
			<SidebarHeader className="h-16 justify-center">
				<div className="flex items-center gap-3 overflow-hidden">
					<BrandMark />
					<div
						className={cn(
							'min-w-0 whitespace-nowrap transition-opacity duration-200',
							collapsed && 'pointer-events-none opacity-0'
						)}
					>
						<div className="font-serif text-xl leading-none text-foreground italic">Asymmetric Alpha</div>
						<div className="kicker mt-1">Omni-Terminal</div>
					</div>
				</div>
			</SidebarHeader>

			<SidebarContent>
				<SidebarGroupLabel>Modules</SidebarGroupLabel>
				<SidebarMenu>
					{MODULES.map((item) => {
						const active = location.pathname.startsWith(item.path);
						const Icon = item.icon;
						return (
							<SidebarMenuItem key={item.path}>
								<SidebarMenuButton
									asChild
									isActive={active}
									tooltip={
										<span>
											<span className="num mr-1.5 text-primary">{item.index}</span>
											{item.label}
										</span>
									}
								>
									<NavLink to={item.path} aria-label={item.label}>
										{active && (
											<span className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full bg-primary shadow-[0_0_12px_var(--primary)]" />
										)}
										<Icon className={cn('ml-0.5', active ? 'text-primary' : 'text-muted-foreground')} />
										<span
											className={cn(
												'flex min-w-0 flex-1 flex-col whitespace-nowrap transition-opacity duration-200',
												collapsed && 'opacity-0'
											)}
										>
											<span className="truncate text-[13px] leading-tight font-medium">{item.label}</span>
											<span className="truncate text-[10.5px] leading-tight text-muted-foreground">
												{item.caption}
											</span>
										</span>
										<span
											className={cn(
												'num text-[10px] transition-opacity duration-200',
												active ? 'text-primary' : 'text-muted-foreground/60',
												collapsed && 'opacity-0'
											)}
										>
											{item.index}
										</span>
									</NavLink>
								</SidebarMenuButton>
							</SidebarMenuItem>
						);
					})}
				</SidebarMenu>
			</SidebarContent>

			<SidebarFooter>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={reseed}
							aria-label="Regenerate mock data with a new seed"
							className="group flex h-12 w-full items-center gap-3 overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 text-left transition-colors outline-none hover:border-primary/30 hover:bg-primary/[0.06] focus-visible:ring-2 focus-visible:ring-ring/50"
						>
							<Dices className="ml-0.5 size-[18px] shrink-0 text-muted-foreground transition-transform duration-500 group-hover:rotate-180 group-hover:text-primary" />
							<span
								className={cn(
									'flex min-w-0 flex-col whitespace-nowrap transition-opacity duration-200',
									collapsed && 'opacity-0'
								)}
							>
								<span className="text-[12px] leading-tight font-medium text-foreground">Reseed mock data</span>
								<span className="num text-[10px] leading-tight text-muted-foreground">
									seed {seed.toString(16).toUpperCase().padStart(8, '0')}
								</span>
							</span>
						</button>
					</TooltipTrigger>
					<TooltipContent side="right">
						Regenerates every dataset — IPO pipeline, portfolio, option desk and tape universe — from a new seed.
					</TooltipContent>
				</Tooltip>
			</SidebarFooter>
		</Sidebar>
	);
}
