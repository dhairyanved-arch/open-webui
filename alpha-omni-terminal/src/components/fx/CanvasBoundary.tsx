import * as React from 'react';
import { TriangleAlert } from 'lucide-react';

function detectWebGL(): boolean {
	try {
		const canvas = document.createElement('canvas');
		return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
	} catch {
		return false;
	}
}

function Fallback({ title, detail }: { title: string; detail: string }) {
	return (
		<div className="flex h-full w-full items-center justify-center p-8 text-center">
			<div className="max-w-sm">
				<TriangleAlert className="mx-auto mb-3 size-6 text-primary" />
				<div className="text-sm font-medium text-foreground">{title}</div>
				<p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
			</div>
		</div>
	);
}

interface BoundaryState {
	error: Error | null;
}

class RenderBoundary extends React.Component<{ children: React.ReactNode }, BoundaryState> {
	state: BoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): BoundaryState {
		return { error };
	}

	render() {
		if (this.state.error) {
			return <Fallback title="The 3D scene stopped rendering" detail={this.state.error.message} />;
		}
		return this.props.children;
	}
}

/**
 * Wraps every Three.js canvas. A WebGL failure or a throw inside the scene graph
 * is contained here, so the rest of the terminal (sidebar, sliders, other
 * modules) keeps working instead of unmounting with the canvas.
 */
export function CanvasBoundary({ children }: { children: React.ReactNode }) {
	const [supported] = React.useState(detectWebGL);
	if (!supported) {
		return (
			<Fallback
				title="WebGL is unavailable"
				detail="This module renders with Three.js and needs WebGL. Enable hardware acceleration or try another browser."
			/>
		);
	}
	return <RenderBoundary>{children}</RenderBoundary>;
}
