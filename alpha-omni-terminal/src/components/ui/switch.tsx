import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

const Switch = React.forwardRef<
	React.ElementRef<typeof SwitchPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
	<SwitchPrimitive.Root
		ref={ref}
		className={cn(
			'peer inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border border-white/10 bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=checked]:border-primary/40 data-[state=checked]:bg-primary/70',
			className
		)}
		{...props}
	>
		<SwitchPrimitive.Thumb className="pointer-events-none block size-3.5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[15px]" />
	</SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';

export { Switch };
