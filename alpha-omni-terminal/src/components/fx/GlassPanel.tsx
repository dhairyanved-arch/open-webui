import * as React from 'react';
import { cn } from '@/lib/utils';

interface GlassPanelProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
	kicker?: React.ReactNode;
	title?: React.ReactNode;
	actions?: React.ReactNode;
	/** Remove body padding (for tables / canvases that run edge to edge). */
	flush?: boolean;
	/** Disable the pointer-follow spotlight. */
	still?: boolean;
	bodyClassName?: string;
}

/**
 * Glassmorphic surface with a pointer-tracked spotlight. The highlight position
 * is written straight to CSS variables, so moving the mouse never re-renders.
 */
export const GlassPanel = React.forwardRef<HTMLDivElement, GlassPanelProps>(
	({ kicker, title, actions, flush, still, className, bodyClassName, children, onPointerMove, ...props }, ref) => {
		const handleMove = (event: React.PointerEvent<HTMLDivElement>) => {
			onPointerMove?.(event);
			if (still) return;
			const el = event.currentTarget;
			const rect = el.getBoundingClientRect();
			el.style.setProperty('--mx', `${event.clientX - rect.left}px`);
			el.style.setProperty('--my', `${event.clientY - rect.top}px`);
		};

		const hasHeader = kicker || title || actions;

		return (
			<section
				ref={ref}
				onPointerMove={handleMove}
				className={cn('glass flex min-h-0 flex-col rounded-xl', !still && 'glass-spot', className)}
				{...props}
			>
				{hasHeader && (
					<header className="relative flex shrink-0 items-start justify-between gap-3 px-4 pt-3.5 pb-2">
						<div className="min-w-0">
							{kicker && <div className="kicker mb-0.5">{kicker}</div>}
							{title && <h2 className="truncate text-sm font-medium text-foreground">{title}</h2>}
						</div>
						{actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
					</header>
				)}
				<div className={cn('relative min-h-0 flex-1', !flush && 'px-4 pb-4', !hasHeader && !flush && 'pt-4', bodyClassName)}>
					{children}
				</div>
			</section>
		);
	}
);
GlassPanel.displayName = 'GlassPanel';
