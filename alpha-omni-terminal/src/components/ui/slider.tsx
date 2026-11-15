import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '@/lib/utils';

type Tone = 'primary' | 'accent' | 'violet' | 'bull' | 'bear';

const toneRange: Record<Tone, string> = {
	primary: 'bg-primary shadow-[0_0_12px_var(--primary)]',
	accent: 'bg-accent shadow-[0_0_12px_var(--accent)]',
	violet: 'bg-violet shadow-[0_0_12px_var(--violet)]',
	bull: 'bg-bull shadow-[0_0_12px_var(--bull)]',
	bear: 'bg-bear shadow-[0_0_12px_var(--bear)]'
};
const toneThumb: Record<Tone, string> = {
	primary: 'border-primary',
	accent: 'border-accent',
	violet: 'border-violet',
	bull: 'border-bull',
	bear: 'border-bear'
};

const Slider = React.forwardRef<
	React.ElementRef<typeof SliderPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & { tone?: Tone }
>(({ className, tone = 'primary', 'aria-label': ariaLabel, ...props }, ref) => (
	<SliderPrimitive.Root
		ref={ref}
		className={cn('relative flex h-5 w-full touch-none items-center select-none', className)}
		{...props}
	>
		<SliderPrimitive.Track className="relative h-[3px] w-full grow overflow-hidden rounded-full bg-white/10">
			<SliderPrimitive.Range className={cn('absolute h-full', toneRange[tone])} />
		</SliderPrimitive.Track>
		<SliderPrimitive.Thumb
			aria-label={ariaLabel}
			className={cn(
				'block size-3.5 rounded-full border-2 bg-background shadow-lg transition-transform outline-none hover:scale-125 focus-visible:scale-125 focus-visible:ring-4 focus-visible:ring-white/10',
				toneThumb[tone]
			)}
		/>
	</SliderPrimitive.Root>
));
Slider.displayName = 'Slider';

export { Slider };
