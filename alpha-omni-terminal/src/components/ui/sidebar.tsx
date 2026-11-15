import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { PanelLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const SIDEBAR_KEYBOARD_SHORTCUT = 'b';
const SIDEBAR_STORAGE_KEY = 'aot:sidebar';
const COMPACT_QUERY = '(max-width: 1100px)';

interface SidebarContextValue {
	state: 'expanded' | 'collapsed';
	open: boolean;
	setOpen: (open: boolean) => void;
	toggleSidebar: () => void;
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebar() {
	const ctx = React.useContext(SidebarContext);
	if (!ctx) throw new Error('useSidebar must be used within a SidebarProvider.');
	return ctx;
}

function readStoredOpen(fallback: boolean) {
	try {
		const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
		if (stored === 'true') return true;
		if (stored === 'false') return false;
	} catch {
		/* storage unavailable — fall through */
	}
	return fallback;
}

export function SidebarProvider({
	defaultOpen = true,
	className,
	children,
	...props
}: React.HTMLAttributes<HTMLDivElement> & { defaultOpen?: boolean }) {
	const [open, setOpenState] = React.useState(() => {
		if (typeof window === 'undefined') return defaultOpen;
		if (window.matchMedia(COMPACT_QUERY).matches) return false;
		return readStoredOpen(defaultOpen);
	});

	const setOpen = React.useCallback((value: boolean) => {
		setOpenState(value);
		try {
			window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(value));
		} catch {
			/* ignore */
		}
	}, []);

	const toggleSidebar = React.useCallback(() => {
		setOpenState((prev) => {
			try {
				window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(!prev));
			} catch {
				/* ignore */
			}
			return !prev;
		});
	}, []);

	// Collapse to the icon rail automatically when the viewport gets tight.
	React.useEffect(() => {
		const mq = window.matchMedia(COMPACT_QUERY);
		const onChange = (e: MediaQueryListEvent) => {
			if (e.matches) setOpenState(false);
		};
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	}, []);

	React.useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key.toLowerCase() === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				toggleSidebar();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [toggleSidebar]);

	const value = React.useMemo<SidebarContextValue>(
		() => ({ state: open ? 'expanded' : 'collapsed', open, setOpen, toggleSidebar }),
		[open, setOpen, toggleSidebar]
	);

	return (
		<SidebarContext.Provider value={value}>
			<div
				data-sidebar-state={value.state}
				className={cn('group/sidebar-wrapper flex h-full w-full', className)}
				{...props}
			>
				{children}
			</div>
		</SidebarContext.Provider>
	);
}

export const Sidebar = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
	({ className, children, ...props }, ref) => {
		const { state } = useSidebar();
		return (
			<aside
				ref={ref}
				data-state={state}
				className={cn(
					'group/sidebar relative z-30 flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground backdrop-blur-2xl transition-[width] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]',
					state === 'expanded' ? 'w-[var(--sidebar-width)]' : 'w-[var(--sidebar-width-icon)]',
					className
				)}
				{...props}
			>
				{children}
			</aside>
		);
	}
);
Sidebar.displayName = 'Sidebar';

export function SidebarHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return <div className={cn('flex flex-col gap-2 p-3', className)} {...props} />;
}

export function SidebarContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn('thin-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto p-3', className)}
			{...props}
		/>
	);
}

export function SidebarFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return <div className={cn('flex flex-col gap-2 border-t border-sidebar-border p-3', className)} {...props} />;
}

export function SidebarGroupLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn(
				'kicker h-6 overflow-hidden px-2 whitespace-nowrap transition-opacity duration-200 group-data-[state=collapsed]/sidebar:opacity-0',
				className
			)}
			{...props}
		/>
	);
}

export function SidebarMenu({ className, ...props }: React.HTMLAttributes<HTMLUListElement>) {
	return <ul className={cn('flex w-full min-w-0 flex-col gap-1', className)} {...props} />;
}

export function SidebarMenuItem({ className, ...props }: React.LiHTMLAttributes<HTMLLIElement>) {
	return <li className={cn('relative', className)} {...props} />;
}

export const SidebarMenuButton = React.forwardRef<
	HTMLButtonElement,
	React.ButtonHTMLAttributes<HTMLButtonElement> & {
		asChild?: boolean;
		isActive?: boolean;
		tooltip?: React.ReactNode;
	}
>(({ asChild = false, isActive = false, tooltip, className, ...props }, ref) => {
	const Comp = asChild ? Slot : 'button';
	const { state } = useSidebar();

	const button = (
		<Comp
			ref={ref}
			data-active={isActive}
			className={cn(
				'group/menu-button relative flex h-12 w-full items-center gap-3 overflow-hidden rounded-lg px-3 text-left text-sm text-sidebar-foreground/80 outline-none transition-colors hover:bg-white/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
				'data-[active=true]:bg-sidebar-accent data-[active=true]:text-foreground',
				'[&>svg]:size-[18px] [&>svg]:shrink-0',
				className
			)}
			{...props}
		/>
	);

	if (!tooltip || state === 'expanded') return button;

	return (
		<Tooltip>
			<TooltipTrigger asChild>{button}</TooltipTrigger>
			<TooltipContent side="right">{tooltip}</TooltipContent>
		</Tooltip>
	);
});
SidebarMenuButton.displayName = 'SidebarMenuButton';

export const SidebarTrigger = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button>>(
	({ className, onClick, ...props }, ref) => {
		const { toggleSidebar, open } = useSidebar();
		return (
			<Button
				ref={ref}
				variant="ghost"
				size="icon-sm"
				aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
				aria-expanded={open}
				className={className}
				onClick={(event) => {
					onClick?.(event);
					toggleSidebar();
				}}
				{...props}
			>
				<PanelLeft />
			</Button>
		);
	}
);
SidebarTrigger.displayName = 'SidebarTrigger';

export function SidebarInset({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
	return <main className={cn('relative flex min-w-0 flex-1 flex-col', className)} {...props} />;
}
