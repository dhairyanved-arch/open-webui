import * as React from 'react';
import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
	({ className, type, ...props }, ref) => (
		<input
			ref={ref}
			type={type}
			className={cn(
				'num flex h-9 w-full min-w-0 rounded-md border border-white/10 bg-black/30 px-3 py-1 text-sm text-foreground shadow-inner transition-colors outline-none placeholder:text-muted-foreground/60 focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-50',
				className
			)}
			{...props}
		/>
	)
);
Input.displayName = 'Input';

export { Input };
