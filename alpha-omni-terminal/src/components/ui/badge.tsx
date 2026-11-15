import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
	'num inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide whitespace-nowrap uppercase',
	{
		variants: {
			variant: {
				default: 'border-white/10 bg-white/5 text-muted-foreground',
				primary: 'border-primary/30 bg-primary/10 text-primary',
				accent: 'border-accent/30 bg-accent/10 text-accent',
				violet: 'border-violet/30 bg-violet/10 text-violet',
				bull: 'border-bull/30 bg-bull/10 text-bull',
				bear: 'border-bear/30 bg-bear/10 text-bear'
			}
		},
		defaultVariants: { variant: 'default' }
	}
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
	return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
