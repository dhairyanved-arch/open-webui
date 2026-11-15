import * as React from 'react';
import * as THREE from 'three';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import {
	EXPIRY_RANGE_DAYS,
	GRID_EXPIRIES,
	GRID_STRIKES,
	METRICS,
	SCENE,
	STRIKE_RANGE,
	evaluatePoint,
	expiryAt,
	expiryToZ,
	heightToY,
	normalise,
	strikeAt,
	strikeToX,
	type SurfaceField,
	type SurfaceMetric,
	type SurfaceParams
} from './surfaceModel';

export interface Probe {
	strike: number;
	days: number;
}

/* ── colour ramps (built once, in linear working space) ───────────────────── */

type Stop = [number, THREE.Color];
const stops = (list: Array<[number, string]>): Stop[] => list.map(([t, hex]) => [t, new THREE.Color(hex)]);

const SEQUENTIAL = stops([
	[0, '#160b40'],
	[0.28, '#4a2fd8'],
	[0.56, '#1cb5e8'],
	[0.82, '#ffb224'],
	[1, '#fff3cc']
]);
const DIVERGING = stops([
	[0, '#ff2d55'],
	[0.36, '#8a2146'],
	[0.5, '#1c2434'],
	[0.64, '#10805a'],
	[1, '#00ff9c']
]);

function sampleRamp(ramp: Stop[], t: number, out: Float32Array, offset: number) {
	const k = t <= 0 ? 0 : t >= 1 ? 1 : t;
	let i = 1;
	while (i < ramp.length - 1 && k > ramp[i][0]) i++;
	const [t0, c0] = ramp[i - 1];
	const [t1, c1] = ramp[i];
	const f = (k - t0) / (t1 - t0 || 1);
	out[offset] = c0.r + (c1.r - c0.r) * f;
	out[offset + 1] = c0.g + (c1.g - c0.g) * f;
	out[offset + 2] = c0.b + (c1.b - c0.b) * f;
}

export const RAMP_CSS = {
	sequential: 'linear-gradient(90deg, #160b40, #4a2fd8 28%, #1cb5e8 56%, #ffb224 82%, #fff3cc)',
	diverging: 'linear-gradient(90deg, #ff2d55, #8a2146 36%, #1c2434 50%, #10805a 64%, #00ff9c)'
};

/* ── static geometry topology ─────────────────────────────────────────────── */

const VERTEX_COUNT = GRID_STRIKES * GRID_EXPIRIES;
const LINE_EVERY = 6;

function buildTopology() {
	const tri: number[] = [];
	for (let iz = 0; iz < GRID_EXPIRIES - 1; iz++) {
		for (let ix = 0; ix < GRID_STRIKES - 1; ix++) {
			const a = iz * GRID_STRIKES + ix;
			const b = a + 1;
			const c = a + GRID_STRIKES;
			const d = c + 1;
			tri.push(a, c, b, b, c, d);
		}
	}
	const lines: number[] = [];
	for (let iz = 0; iz < GRID_EXPIRIES; iz++) {
		if (iz % LINE_EVERY !== 0 && iz !== GRID_EXPIRIES - 1) continue;
		for (let ix = 0; ix < GRID_STRIKES - 1; ix++) lines.push(iz * GRID_STRIKES + ix, iz * GRID_STRIKES + ix + 1);
	}
	for (let ix = 0; ix < GRID_STRIKES; ix++) {
		if (ix % LINE_EVERY !== 0 && ix !== GRID_STRIKES - 1) continue;
		for (let iz = 0; iz < GRID_EXPIRIES - 1; iz++) lines.push(iz * GRID_STRIKES + ix, (iz + 1) * GRID_STRIKES + ix);
	}
	return { tri, lines };
}

/* ── the surface ──────────────────────────────────────────────────────────── */

function Surface({
	field,
	params,
	metric,
	showGrid,
	onProbe
}: {
	field: SurfaceField;
	params: SurfaceParams;
	metric: SurfaceMetric;
	showGrid: boolean;
	onProbe: (probe: Probe | null) => void;
}) {
	// Geometry objects are created once; only their buffers are rewritten.
	const { surface, gridLines, ridge } = React.useMemo(() => {
		const { tri, lines } = buildTopology();
		const position = new THREE.BufferAttribute(new Float32Array(VERTEX_COUNT * 3), 3);
		position.setUsage(THREE.DynamicDrawUsage);
		const color = new THREE.BufferAttribute(new Float32Array(VERTEX_COUNT * 3), 3);
		color.setUsage(THREE.DynamicDrawUsage);

		const surfaceGeo = new THREE.BufferGeometry();
		surfaceGeo.setAttribute('position', position);
		surfaceGeo.setAttribute('color', color);
		surfaceGeo.setIndex(tri);

		// The wire overlay shares the surface's position buffer — one upload, always in sync.
		const lineGeo = new THREE.BufferGeometry();
		lineGeo.setAttribute('position', position);
		lineGeo.setIndex(lines);

		const ridgeGeo = new THREE.BufferGeometry();
		const ridgePos = new THREE.BufferAttribute(new Float32Array(GRID_EXPIRIES * 3), 3);
		ridgePos.setUsage(THREE.DynamicDrawUsage);
		ridgeGeo.setAttribute('position', ridgePos);
		const ridgeLine = new THREE.Line(
			ridgeGeo,
			new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false })
		);
		ridgeLine.renderOrder = 3;
		ridgeLine.frustumCulled = false;

		return { surface: surfaceGeo, gridLines: lineGeo, ridge: ridgeLine };
	}, []);

	React.useEffect(
		() => () => {
			surface.dispose();
			gridLines.dispose();
			ridge.geometry.dispose();
			(ridge.material as THREE.Material).dispose();
		},
		[surface, gridLines, ridge]
	);

	// Rewrite vertex positions + colours whenever the model changes. This runs in a
	// layout effect (not in the render loop), so it can never feed back into React state.
	React.useLayoutEffect(() => {
		const pos = surface.getAttribute('position') as THREE.BufferAttribute;
		const col = surface.getAttribute('color') as THREE.BufferAttribute;
		const p = pos.array as Float32Array;
		const c = col.array as Float32Array;
		const ramp = field.signed ? DIVERGING : SEQUENTIAL;
		for (let iz = 0; iz < GRID_EXPIRIES; iz++) {
			const z = (1 - (iz / (GRID_EXPIRIES - 1)) * 2) * SCENE.halfZ;
			for (let ix = 0; ix < GRID_STRIKES; ix++) {
				const i = iz * GRID_STRIKES + ix;
				const u = field.u[i];
				p[i * 3] = ((ix / (GRID_STRIKES - 1)) * 2 - 1) * SCENE.halfX;
				p[i * 3 + 1] = heightToY(u, field.signed);
				p[i * 3 + 2] = z;
				sampleRamp(ramp, field.signed ? (u + 1) / 2 : u, c, i * 3);
			}
		}
		pos.needsUpdate = true;
		col.needsUpdate = true;
		surface.computeVertexNormals();
		surface.computeBoundingSphere();
		surface.computeBoundingBox();

		// At-the-money ridge: the surface traced along strike = spot.
		const spec = METRICS[metric];
		const rp = ridge.geometry.getAttribute('position') as THREE.BufferAttribute;
		const r = rp.array as Float32Array;
		const lo = params.refSpot * STRIKE_RANGE[0];
		const hi = params.refSpot * STRIKE_RANGE[1];
		const strike = Math.min(hi, Math.max(lo, params.spot));
		const x = strikeToX(params, strike);
		for (let iz = 0; iz < GRID_EXPIRIES; iz++) {
			const days = expiryAt(iz / (GRID_EXPIRIES - 1));
			const pt = evaluatePoint(params, strike, days);
			const u = normalise(spec, spec.raw(pt.greeks, pt.sigma), params.refSpot);
			r[iz * 3] = x;
			r[iz * 3 + 1] = heightToY(u, field.signed) + 0.015;
			r[iz * 3 + 2] = expiryToZ(days);
		}
		rp.needsUpdate = true;
	}, [field, params, metric, surface, ridge]);

	// Hover probe, coalesced to one update per animation frame.
	const pending = React.useRef<Probe | null>(null);
	const frame = React.useRef(0);
	const flush = React.useCallback(() => {
		frame.current = 0;
		onProbe(pending.current);
	}, [onProbe]);
	React.useEffect(() => () => cancelAnimationFrame(frame.current), []);

	const handleMove = (event: ThreeEvent<PointerEvent>) => {
		const fx = (event.point.x / SCENE.halfX + 1) / 2;
		const fz = (1 - event.point.z / SCENE.halfZ) / 2;
		pending.current = {
			strike: strikeAt(params, Math.min(1, Math.max(0, fx))),
			days: expiryAt(Math.min(1, Math.max(0, fz)))
		};
		if (!frame.current) frame.current = requestAnimationFrame(flush);
	};
	const handleOut = () => {
		pending.current = null;
		if (!frame.current) frame.current = requestAnimationFrame(flush);
	};

	return (
		<group>
			<mesh geometry={surface} onPointerMove={handleMove} onPointerOut={handleOut}>
				<meshStandardMaterial
					vertexColors
					side={THREE.DoubleSide}
					roughness={0.42}
					metalness={0.12}
					polygonOffset
					polygonOffsetFactor={1}
					polygonOffsetUnits={1}
				/>
			</mesh>
			{showGrid && (
				<lineSegments geometry={gridLines} frustumCulled={false}>
					<lineBasicMaterial color="#ffffff" transparent opacity={0.16} />
				</lineSegments>
			)}
			<primitive object={ridge} />
		</group>
	);
}

/* ── floor, axes and labels ───────────────────────────────────────────────── */

const STRIKE_TICKS = [0.8, 0.9, 1.0, 1.1, 1.2];
const EXPIRY_TICKS = [7, 30, 60, 90, 120];

function AxisLabel({
	position,
	children,
	tone = 'muted'
}: {
	position: [number, number, number];
	children: React.ReactNode;
	tone?: 'muted' | 'primary' | 'bear' | 'title';
}) {
	const color =
		tone === 'primary' ? '#ffb224' : tone === 'bear' ? '#ff2d55' : tone === 'title' ? 'rgb(255 255 255 / 0.55)' : 'rgb(255 255 255 / 0.45)';
	return (
		<Html position={position} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
			<span
				className="num whitespace-nowrap select-none"
				style={{ color, fontSize: tone === 'title' ? 9 : 10, letterSpacing: tone === 'title' ? '0.2em' : undefined }}
			>
				{children}
			</span>
		</Html>
	);
}

function Stage({ params, signed }: { params: SurfaceParams; signed: boolean }) {
	const floor = React.useMemo(() => {
		const pts: number[] = [];
		const { halfX, halfZ } = SCENE;
		// border
		pts.push(-halfX, 0, -halfZ, halfX, 0, -halfZ, halfX, 0, -halfZ, halfX, 0, halfZ);
		pts.push(halfX, 0, halfZ, -halfX, 0, halfZ, -halfX, 0, halfZ, -halfX, 0, -halfZ);
		for (const m of STRIKE_TICKS) {
			const x = strikeToX({ refSpot: 1 }, m);
			pts.push(x, 0, -halfZ, x, 0, halfZ);
		}
		for (const d of EXPIRY_TICKS) {
			const z = expiryToZ(d);
			pts.push(-halfX, 0, z, halfX, 0, z);
		}
		// back-wall posts so height reads against something
		for (const x of [-halfX, halfX]) pts.push(x, 0, -halfZ, x, SCENE.height, -halfZ);
		pts.push(-halfX, SCENE.height, -halfZ, halfX, SCENE.height, -halfZ);
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
		return geo;
	}, []);
	React.useEffect(() => () => floor.dispose(), [floor]);

	const spotInRange = params.spot >= params.refSpot * STRIKE_RANGE[0] && params.spot <= params.refSpot * STRIKE_RANGE[1];
	const spotX = strikeToX(params, params.spot);
	const expiredDays = Math.min(EXPIRY_RANGE_DAYS[1], params.daysElapsed);
	const expiredDepth = expiredDays > EXPIRY_RANGE_DAYS[0] ? SCENE.halfZ - expiryToZ(expiredDays) : 0;

	return (
		<group>
			<lineSegments geometry={floor}>
				<lineBasicMaterial color="#ffffff" transparent opacity={0.12} />
			</lineSegments>

			{/* zero plane for signed metrics */}
			{signed && (
				<mesh position={[0, SCENE.height / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
					<planeGeometry args={[SCENE.halfX * 2, SCENE.halfZ * 2]} />
					<meshBasicMaterial color="#ffffff" transparent opacity={0.035} side={THREE.DoubleSide} depthWrite={false} />
				</mesh>
			)}

			{/* expiries already burned away by the theta slider */}
			{expiredDepth > 0 && (
				<>
					<mesh position={[0, 0.006, SCENE.halfZ - expiredDepth / 2]} rotation={[-Math.PI / 2, 0, 0]}>
						<planeGeometry args={[SCENE.halfX * 2, expiredDepth]} />
						<meshBasicMaterial color="#ff2d55" transparent opacity={0.13} depthWrite={false} />
					</mesh>
					<AxisLabel position={[-SCENE.halfX - 0.75, 0, SCENE.halfZ - expiredDepth / 2]} tone="bear">
						EXPIRED
					</AxisLabel>
				</>
			)}

			{/* spot marker on the floor */}
			{spotInRange && (
				<>
					<mesh position={[spotX, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
						<planeGeometry args={[0.035, SCENE.halfZ * 2]} />
						<meshBasicMaterial color="#ffb224" transparent opacity={0.9} />
					</mesh>
					<AxisLabel position={[spotX, 0, SCENE.halfZ + 0.95]} tone="primary">
						SPOT {Math.round(params.spot).toLocaleString('en-IN')}
					</AxisLabel>
				</>
			)}

			{STRIKE_TICKS.map((m) => (
				<AxisLabel key={m} position={[strikeToX({ refSpot: 1 }, m), 0, SCENE.halfZ + 0.4]}>
					{Math.round(params.refSpot * m).toLocaleString('en-IN')}
				</AxisLabel>
			))}
			{EXPIRY_TICKS.map((d) => (
				<AxisLabel key={d} position={[SCENE.halfX + 0.5, 0, expiryToZ(d)]}>
					{d}d
				</AxisLabel>
			))}
			<AxisLabel position={[-SCENE.halfX + 1.6, 0, SCENE.halfZ + 1.0]} tone="title">
				STRIKE →
			</AxisLabel>
			<AxisLabel position={[SCENE.halfX + 1.15, 0, SCENE.halfZ * 0.25]} tone="title">
				EXPIRY
			</AxisLabel>
		</group>
	);
}

function ProbeMarker({ probe, params, metric, signed }: { probe: Probe; params: SurfaceParams; metric: SurfaceMetric; signed: boolean }) {
	const spec = METRICS[metric];
	const pt = evaluatePoint(params, probe.strike, probe.days);
	const y = heightToY(normalise(spec, spec.raw(pt.greeks, pt.sigma), params.refSpot), signed);
	const x = strikeToX(params, probe.strike);
	const z = expiryToZ(probe.days);
	return (
		<group>
			<mesh position={[x, y, z]}>
				<sphereGeometry args={[0.085, 20, 20]} />
				<meshBasicMaterial color="#ffffff" />
			</mesh>
			<mesh position={[x, y / 2, z]}>
				<cylinderGeometry args={[0.008, 0.008, Math.max(0.001, y), 6]} />
				<meshBasicMaterial color="#ffffff" transparent opacity={0.5} />
			</mesh>
		</group>
	);
}

export interface SurfaceSceneProps {
	field: SurfaceField;
	params: SurfaceParams;
	metric: SurfaceMetric;
	showGrid: boolean;
	autoRotate: boolean;
	probe: Probe | null;
	onProbe: (probe: Probe | null) => void;
}

export function SurfaceScene({ field, params, metric, showGrid, autoRotate, probe, onProbe }: SurfaceSceneProps) {
	return (
		<Canvas
			dpr={[1, 2]}
			gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
			camera={{ position: [10.8, 8.2, 15.2], fov: 34, near: 0.1, far: 200 }}
		>
			<ambientLight intensity={0.75} />
			<directionalLight position={[6, 12, 5]} intensity={1.5} />
			<pointLight position={[-9, 7, -6]} intensity={45} color="#ffb224" />
			<pointLight position={[10, 7, 9]} intensity={30} color="#4de3ff" />

			<Stage params={params} signed={field.signed} />
			<Surface field={field} params={params} metric={metric} showGrid={showGrid} onProbe={onProbe} />
			{probe && <ProbeMarker probe={probe} params={params} metric={metric} signed={field.signed} />}

			{/* Polar and distance limits keep the camera above the floor and outside
			    the mesh, so nothing clips through the near plane. */}
			<OrbitControls
				makeDefault
				enablePan={false}
				enableDamping
				dampingFactor={0.08}
				target={[0.35, 1.1, 0]}
				minDistance={9}
				maxDistance={30}
				minPolarAngle={0.25}
				maxPolarAngle={1.5}
				autoRotate={autoRotate}
				autoRotateSpeed={0.6}
			/>
		</Canvas>
	);
}
