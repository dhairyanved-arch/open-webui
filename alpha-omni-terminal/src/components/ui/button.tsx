import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
	'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]',
	{
		variants: {
			variant: {
				default:
					'bg-primary text-primary-foreground shadow-[0_0_24px_-6px_var(--primary)] hover:brightness-110',
				outline: 'border border-white/10 bg-white/[0.03] text-foreground hover:bg-white/[0.08] hover:border-white/20',
				ghost: 'text-muted-foreground hover:bg-white/[0.06] hover:text-foreground',
				accent: 'bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25',
				bull: 'bg-bull/12 text-bull border border-bull/30 hover:bg-bull/20',
				bear: 'bg-bear/12 text-bear border border-bear/30 hover:bg-bear/20'
			},
			size: {
				default: 'h-9 px-4',
				sm: 'h-8 px-3 text-xs',
				xs: 'h-7 px-2.5 text-[11px]',
				icon: 'size-9',
				'icon-sm': 'size-7'
			}
		},
		defaultVariants: { variant: 'default', size: 'default' }
	}
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : 'button';
		return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
	}
);
Button.displayName = 'Button';

export { Button, buttonVariants };
