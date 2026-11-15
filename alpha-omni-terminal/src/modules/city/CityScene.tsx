import * as React from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html, OrbitControls, Stars } from '@react-three/drei';
import type { AssetClass } from '@/data/generators';
import { formatInrCompact, formatPctSigned } from '@/lib/format';
import { Rng, hashString } from '@/lib/rng';
import { CLASS_META, WEATHER_META, type BuildingSpec, type CityLayout, type DistrictSpec } from './cityModel';

/* ── shared procedural textures (created lazily, once) ────────────────────── */

let softTexture: THREE.CanvasTexture | null = null;
function getSoftTexture() {
	if (softTexture) return softTexture;
	const size = 128;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext('2d')!;
	const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
	g.addColorStop(0, 'rgba(255,255,255,1)');
	g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
	g.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, size, size);
	softTexture = new THREE.CanvasTexture(canvas);
	softTexture.colorSpace = THREE.SRGBColorSpace;
	return softTexture;
}

const windowTextures = new Map<number, THREE.CanvasTexture>();
/** Lit-window grid used as an emissive map. A few variants keep façades from repeating. */
function getWindowTexture(variant: number) {
	const cached = windowTextures.get(variant);
	if (cached) return cached;
	const rng = new Rng(9001 + variant * 131);
	const canvas = document.createElement('canvas');
	canvas.width = 64;
	canvas.height = 64;
	const ctx = canvas.getContext('2d')!;
	// Wall: a faint even glow so the mass reads as solid at night.
	ctx.fillStyle = 'rgb(30,30,30)';
	ctx.fillRect(0, 0, 64, 64);
	const cols = 4;
	const rows = 4;
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			// Unlit panes are darker than the wall; lit ones vary in brightness.
			const lit = rng.next() < 0.58;
			const v = lit ? Math.round(140 + rng.next() * 115) : 6;
			ctx.fillStyle = `rgb(${v},${v},${v})`;
			ctx.fillRect(c * 16 + 3, r * 16 + 4, 10, 8);
		}
	}
	const tex = new THREE.CanvasTexture(canvas);
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.magFilter = THREE.NearestFilter;
	windowTextures.set(variant, tex);
	return tex;
}

function useFacade(seed: number, repeatX: number, repeatY: number) {
	const rx = Math.max(1, Math.round(repeatX));
	const ry = Math.max(1, Math.round(repeatY));
	const variant = seed % 4;
	const texture = React.useMemo(() => {
		const t = getWindowTexture(variant).clone();
		t.repeat.set(rx, ry);
		t.offset.set(((seed >> 3) % 4) / 4, ((seed >> 5) % 4) / 4);
		t.needsUpdate = true;
		return t;
	}, [variant, rx, ry, seed]);
	React.useEffect(() => () => texture.dispose(), [texture]);
	return texture;
}

/* ── architecture, one style per asset class ──────────────────────────────── */

interface StyleProps {
	spec: BuildingSpec;
	glow: number;
}

/** Equities: slender glass shaft, setback crown, antenna spire, neon corner strips. */
function EquityTower({ spec, glow }: StyleProps) {
	const { width: w, depth: d, height: h, seed } = spec;
	const shaft = h * 0.88;
	const facade = useFacade(seed, w * 1.6, shaft * 1.15);
	const accent = CLASS_META.equity.color;
	return (
		<group>
			<mesh position={[0, shaft / 2, 0]}>
				<boxGeometry args={[w, shaft, d]} />
				<meshStandardMaterial color="#1b3a5c" metalness={0.3} roughness={0.32} emissive="#7deaff" emissiveMap={facade} emissiveIntensity={0.95 * glow} />
			</mesh>
			<mesh position={[0, shaft + h * 0.06, 0]}>
				<boxGeometry args={[w * 0.62, h * 0.12, d * 0.62]} />
				<meshStandardMaterial color="#24486e" metalness={0.3} roughness={0.3} />
			</mesh>
			<mesh position={[0, h + h * 0.12, 0]}>
				<cylinderGeometry args={[0.012, 0.05, h * 0.24, 6]} />
				<meshStandardMaterial color="#c3d4e6" metalness={0.4} roughness={0.35} />
			</mesh>
			{[
				[1, 1],
				[1, -1],
				[-1, 1],
				[-1, -1]
			].map(([sx, sz], i) => (
				<mesh key={i} position={[(sx * w) / 2, shaft / 2, (sz * d) / 2]}>
					<boxGeometry args={[0.045, shaft, 0.045]} />
					<meshBasicMaterial color={accent} toneMapped={false} transparent opacity={0.55 + 0.4 * (glow - 1)} />
				</mesh>
			))}
		</group>
	);
}

/** Mutual funds: a stack of setbacks — many holdings pooled into one stepped mass. */
function FundTower({ spec, glow }: StyleProps) {
	const { width: w, depth: d, height: h, seed } = spec;
	const tiers = [
		{ k: 1, hh: h * 0.46 },
		{ k: 0.74, hh: h * 0.3 },
		{ k: 0.5, hh: h * 0.24 }
	];
	const facade = useFacade(seed, w * 1.5, h * 0.55);
	const accent = CLASS_META.mutual_fund.color;
	let base = 0;
	return (
		<group>
			{tiers.map((tier, i) => {
				const y = base + tier.hh / 2;
				const top = base + tier.hh;
				base = top;
				return (
					<group key={i}>
						<mesh position={[0, y, 0]}>
							<boxGeometry args={[w * tier.k, tier.hh, d * tier.k]} />
							<meshStandardMaterial color="#33276a" metalness={0.25} roughness={0.42} emissive="#c9b6ff" emissiveMap={facade} emissiveIntensity={0.85 * glow} />
						</mesh>
						<mesh position={[0, top, 0]}>
							<boxGeometry args={[w * tier.k + 0.07, 0.05, d * tier.k + 0.07]} />
							<meshBasicMaterial color={accent} toneMapped={false} transparent opacity={0.6 + 0.4 * (glow - 1)} />
						</mesh>
					</group>
				);
			})}
		</group>
	);
}

/** Debt: a low, wide hall on a podium with a colonnade and pediment — built to stay put. */
function DebtHall({ spec, glow }: StyleProps) {
	const { width: w, depth: d, height: h, seed } = spec;
	const podium = h * 0.16;
	const body = h * 0.62;
	const roof = h * 0.1;
	const facade = useFacade(seed, w * 1.1, 2);
	const columns = Math.max(4, Math.round(w / 0.55));
	const accent = CLASS_META.debt.color;
	const columnXs = Array.from({ length: columns }, (_, i) => -w / 2 + 0.16 + (i * (w - 0.32)) / (columns - 1));
	return (
		<group>
			<mesh position={[0, podium / 2, 0]}>
				<boxGeometry args={[w, podium, d]} />
				<meshStandardMaterial color="#5a4e3a" roughness={0.9} />
			</mesh>
			<mesh position={[0, podium + body / 2, 0]}>
				<boxGeometry args={[w * 0.82, body, d * 0.7]} />
				<meshStandardMaterial color="#4a3d28" roughness={0.75} emissive="#ffc45c" emissiveMap={facade} emissiveIntensity={1.0 * glow} />
			</mesh>
			{[1, -1].map((side) =>
				columnXs.map((x, i) => (
					<mesh key={`${side}-${i}`} position={[x, podium + body / 2, (side * d) / 2 - side * 0.13]}>
						<cylinderGeometry args={[0.075, 0.09, body, 10]} />
						<meshStandardMaterial color="#cdbf9f" roughness={0.6} emissive={accent} emissiveIntensity={0.1 * glow} />
					</mesh>
				))
			)}
			<mesh position={[0, podium + body + roof / 2, 0]}>
				<boxGeometry args={[w * 1.03, roof, d * 1.03]} />
				<meshStandardMaterial color="#6b5a3e" roughness={0.8} />
			</mesh>
			{/* hipped roof: a four-sided pyramid, turned 45° then stretched to the footprint */}
			<group position={[0, podium + body + roof + h * 0.09, 0]} scale={[w * 0.72, h * 0.18, d * 0.72]}>
				<mesh rotation={[0, Math.PI / 4, 0]}>
					<cylinderGeometry args={[0.001, 1, 1, 4, 1]} />
					<meshStandardMaterial color="#7a6646" roughness={0.75} emissive={accent} emissiveIntensity={0.05 * glow} />
				</mesh>
			</group>
		</group>
	);
}

const STYLE_COMPONENT: Record<AssetClass, React.ComponentType<StyleProps>> = {
	equity: EquityTower,
	mutual_fund: FundTower,
	debt: DebtHall
};

function Building({
	spec,
	active,
	selected,
	onHover,
	onSelect
}: {
	spec: BuildingSpec;
	active: boolean;
	selected: boolean;
	onHover: (id: string | null) => void;
	onSelect: (id: string) => void;
}) {
	const group = React.useRef<THREE.Group>(null);
	const Style = STYLE_COMPONENT[spec.holding.assetClass];
	const up = spec.holding.dayChangePct >= 0;
	const beacon = up ? '#00ff9c' : '#ff2d55';
	const top = spec.holding.assetClass === 'equity' ? spec.height * 1.24 : spec.height * 1.02;

	// Buildings rise out of the ground on mount. Scale is animated imperatively —
	// no React state is touched from the render loop.
	useFrame((_, delta) => {
		const g = group.current;
		if (g && g.scale.y < 0.999) g.scale.y = Math.min(1, THREE.MathUtils.damp(g.scale.y, 1, 4.5, Math.min(delta, 0.05)) + 0.0005);
	});

	const handleOver = (event: ThreeEvent<PointerEvent>) => {
		event.stopPropagation();
		onHover(spec.holding.id);
	};
	const handleOut = () => onHover(null);
	const handleClick = (event: ThreeEvent<MouseEvent>) => {
		event.stopPropagation();
		onSelect(spec.holding.id);
	};

	return (
		<group position={[spec.x, 0.14, spec.z]}>
			<group ref={group} scale={[1, 0.02, 1]} onPointerOver={handleOver} onPointerOut={handleOut} onClick={handleClick}>
				<Style spec={spec} glow={active || selected ? 1.9 : 1} />
				<mesh position={[0, top + 0.1, 0]}>
					<sphereGeometry args={[0.085, 12, 12]} />
					<meshBasicMaterial color={beacon} toneMapped={false} />
				</mesh>
			</group>
			{(active || selected) && (
				<>
					<mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
						<ringGeometry args={[Math.max(spec.width, spec.depth) * 0.78, Math.max(spec.width, spec.depth) * 0.78 + 0.07, 48]} />
						<meshBasicMaterial color={selected ? '#ffffff' : CLASS_META[spec.holding.assetClass].color} toneMapped={false} transparent opacity={0.9} />
					</mesh>
					<Html position={[0, top + 0.7, 0]} center zIndexRange={[40, 30]} style={{ pointerEvents: 'none' }}>
						<div className="hud num rounded-md px-2.5 py-1.5 text-[11px] whitespace-nowrap shadow-xl">
							<div className="font-sans text-[12px] font-medium text-foreground">{spec.holding.name}</div>
							<div className="mt-0.5 flex gap-2.5 text-muted-foreground">
								<span className="text-foreground">{formatInrCompact(spec.holding.value)}</span>
								<span>{spec.weightPct.toFixed(1)}% of book</span>
								<span className={up ? 'text-bull' : 'text-bear'}>{formatPctSigned(spec.holding.dayChangePct)}</span>
							</div>
						</div>
					</Html>
				</>
			)}
		</group>
	);
}

/* ── weather systems ──────────────────────────────────────────────────────── */

function Sun({ d }: { d: DistrictSpec }) {
	const rays = React.useRef<THREE.Mesh>(null);
	const y = d.maxHeight + 3.4;
	const reach = Math.max(d.width, d.depth);
	// Brighter the stronger the rally.
	const power = Math.min(1.6, 0.7 + d.sigmaMove * 0.35);
	useFrame((_, delta) => {
		if (rays.current) rays.current.rotation.y += delta * 0.12;
	});
	return (
		<group position={[d.x - d.width * 0.18, 0, d.z - d.depth * 0.18]}>
			<mesh position={[0, y, 0]}>
				<sphereGeometry args={[0.5, 24, 24]} />
				<meshBasicMaterial color="#ffe2a0" toneMapped={false} />
			</mesh>
			<sprite position={[0, y, 0]} scale={[7 * power, 7 * power, 1]}>
				<spriteMaterial map={getSoftTexture()} color="#ffb347" transparent opacity={0.6} depthWrite={false} blending={THREE.AdditiveBlending} />
			</sprite>
			<mesh ref={rays} position={[0, y / 2, 0]}>
				<coneGeometry args={[reach * 0.62, y, 28, 1, true]} />
				<meshBasicMaterial color="#ffcf7a" transparent opacity={0.055 * power} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
			</mesh>
			<pointLight position={[0, y - 0.6, 0]} color="#ffc46b" intensity={70 * power} distance={reach * 2.6} decay={1.6} />
		</group>
	);
}

interface Puff {
	x: number;
	y: number;
	z: number;
	scale: number;
	phase: number;
	speed: number;
}

function makePuffs(d: DistrictSpec, count: number, yLo: number, yHi: number, scaleLo: number, scaleHi: number, salt: string): Puff[] {
	const rng = new Rng(hashString(d.sector + salt));
	return Array.from({ length: count }, () => ({
		x: rng.range(-d.width / 2, d.width / 2),
		y: rng.range(yLo, yHi),
		z: rng.range(-d.depth / 2, d.depth / 2),
		scale: rng.range(scaleLo, scaleHi),
		phase: rng.range(0, Math.PI * 2),
		speed: rng.range(0.12, 0.3)
	}));
}

function FogBank({ d }: { d: DistrictSpec }) {
	const group = React.useRef<THREE.Group>(null);
	const top = Math.max(1.6, d.maxHeight * 0.55);
	const puffs = React.useMemo(
		() => makePuffs(d, 11, 0.5, top, 4.2, 7.5, 'fog'),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[d.sector, d.width, d.depth, top]
	);
	useFrame(({ clock }) => {
		const g = group.current;
		if (!g) return;
		const t = clock.elapsedTime;
		g.children.forEach((child, i) => {
			const p = puffs[i];
			if (!p) return;
			child.position.x = p.x + Math.sin(t * p.speed + p.phase) * 0.9;
			child.position.z = p.z + Math.cos(t * p.speed * 0.8 + p.phase) * 0.6;
		});
	});
	return (
		<group ref={group} position={[d.x, 0, d.z]}>
			{puffs.map((p, i) => (
				<sprite key={i} position={[p.x, p.y, p.z]} scale={[p.scale, p.scale * 0.55, 1]}>
					<spriteMaterial map={getSoftTexture()} color="#b4bfd0" transparent opacity={0.2} depthWrite={false} />
				</sprite>
			))}
		</group>
	);
}

function RainCell({ d, storm }: { d: DistrictSpec; storm: boolean }) {
	const ceiling = d.maxHeight + 3;
	const area = d.width * d.depth;
	const count = Math.round(Math.min(380, Math.max(90, area * 3.2)) * (storm ? 1.7 : 1));
	const speed = storm ? 17 : 11;
	const length = storm ? 0.5 : 0.34;
	const lean = storm ? 0.22 : 0.06;

	const clouds = React.useMemo(
		() => makePuffs(d, storm ? 9 : 7, ceiling, ceiling + 0.9, 5, 8, 'cloud'),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[d.sector, d.width, d.depth, ceiling, storm]
	);

	const rain = React.useMemo(() => {
		const rng = new Rng(hashString(d.sector + 'rain'));
		const positions = new Float32Array(count * 6);
		for (let i = 0; i < count; i++) {
			const x = rng.range(-d.width / 2, d.width / 2);
			const z = rng.range(-d.depth / 2, d.depth / 2);
			const y = rng.range(0, ceiling);
			positions.set([x, y, z, x + lean * length, y - length, z], i * 6);
		}
		const geometry = new THREE.BufferGeometry();
		const attribute = new THREE.BufferAttribute(positions, 3);
		attribute.setUsage(THREE.DynamicDrawUsage);
		geometry.setAttribute('position', attribute);
		return geometry;
	}, [d.sector, d.width, d.depth, ceiling, count, lean, length]);
	React.useEffect(() => () => rain.dispose(), [rain]);

	const bolt = React.useRef<THREE.PointLight>(null);
	const flashSprite = React.useRef<THREE.Sprite>(null);
	const strike = React.useRef({ timer: 1.2, energy: 0, rng: new Rng(hashString(d.sector + 'bolt')) });

	useFrame((_, rawDelta) => {
		const delta = Math.min(rawDelta, 0.05);
		const attribute = rain.getAttribute('position') as THREE.BufferAttribute;
		const p = attribute.array as Float32Array;
		const fall = speed * delta;
		for (let i = 0; i < p.length; i += 6) {
			p[i + 1] -= fall;
			p[i + 4] -= fall;
			if (p[i + 4] < 0) {
				p[i + 1] = ceiling;
				p[i + 4] = ceiling - length;
			}
		}
		attribute.needsUpdate = true;

		if (storm) {
			const s = strike.current;
			s.timer -= delta;
			if (s.timer <= 0) {
				s.energy = 1;
				s.timer = s.rng.range(1.4, 4.6);
			}
			s.energy *= Math.exp(-delta * 9);
			if (bolt.current) bolt.current.intensity = s.energy * 900;
			if (flashSprite.current) flashSprite.current.material.opacity = s.energy * 0.9;
		}
	});

	return (
		<group position={[d.x, 0, d.z]}>
			{clouds.map((p, i) => (
				<sprite key={i} position={[p.x, p.y, p.z]} scale={[p.scale, p.scale * 0.5, 1]}>
					<spriteMaterial map={getSoftTexture()} color={storm ? '#3b4257' : '#5a6880'} transparent opacity={0.85} depthWrite={false} />
				</sprite>
			))}
			<lineSegments geometry={rain} frustumCulled={false}>
				<lineBasicMaterial color={storm ? '#a9c8ff' : '#7fb4f5'} transparent opacity={storm ? 0.5 : 0.38} depthWrite={false} />
			</lineSegments>
			<pointLight position={[0, ceiling - 1, 0]} color="#4f8dff" intensity={18} distance={Math.max(d.width, d.depth) * 2} decay={1.8} />
			{storm && (
				<>
					<pointLight ref={bolt} position={[0, ceiling - 0.5, 0]} color="#e6edff" intensity={0} distance={Math.max(d.width, d.depth) * 4} decay={1.4} />
					<sprite ref={flashSprite} position={[0, ceiling + 0.3, 0]} scale={[d.width * 1.4, 3.4, 1]}>
						<spriteMaterial map={getSoftTexture()} color="#dfe8ff" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
					</sprite>
				</>
			)}
		</group>
	);
}

function WeatherSystem({ d }: { d: DistrictSpec }) {
	if (d.weather === 'sun') return <Sun d={d} />;
	if (d.weather === 'fog') return <FogBank d={d} />;
	return <RainCell d={d} storm={d.weather === 'storm'} />;
}

/* ── districts and ground ─────────────────────────────────────────────────── */

const PAD_SURFACE: Record<DistrictSpec['weather'], { color: string; roughness: number; metalness: number }> = {
	sun: { color: '#1c1710', roughness: 0.85, metalness: 0.1 },
	fog: { color: '#12161c', roughness: 0.9, metalness: 0.05 },
	rain: { color: '#0b1420', roughness: 0.22, metalness: 0.65 },
	storm: { color: '#0a0f1a', roughness: 0.16, metalness: 0.75 }
};

const WEATHER_GLYPH: Record<DistrictSpec['weather'], string> = { sun: '☀', fog: '≋', rain: '☂', storm: '⚡' };

function DistrictPad({ d }: { d: DistrictSpec }) {
	const outline = React.useMemo(() => {
		const hw = d.width / 2;
		const hd = d.depth / 2;
		return new THREE.BufferGeometry().setFromPoints([
			new THREE.Vector3(-hw, 0, -hd),
			new THREE.Vector3(hw, 0, -hd),
			new THREE.Vector3(hw, 0, hd),
			new THREE.Vector3(-hw, 0, hd)
		]);
	}, [d.width, d.depth]);
	React.useEffect(() => () => outline.dispose(), [outline]);

	const surface = PAD_SURFACE[d.weather];
	const classColor = CLASS_META[d.assetClass].color;
	const up = d.dayChangePct >= 0;

	return (
		<group position={[d.x, 0, d.z]}>
			<mesh position={[0, 0.07, 0]}>
				<boxGeometry args={[d.width, 0.14, d.depth]} />
				<meshStandardMaterial color={surface.color} roughness={surface.roughness} metalness={surface.metalness} />
			</mesh>
			<lineLoop geometry={outline} position={[0, 0.15, 0]}>
				<lineBasicMaterial color={classColor} transparent opacity={0.75} toneMapped={false} />
			</lineLoop>
			<Html position={[0, 0.2, d.depth / 2 + 0.55]} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
				<div className="num flex items-center gap-1.5 rounded-full border border-white/10 bg-[rgb(6_9_13/0.78)] px-2 py-0.5 text-[10px] whitespace-nowrap backdrop-blur-sm">
					<span style={{ color: WEATHER_META[d.weather].color }}>{WEATHER_GLYPH[d.weather]}</span>
					<span className="font-sans font-medium text-foreground/90">{d.sector}</span>
					<span className="text-muted-foreground">{d.weightPct.toFixed(0)}%</span>
					<span className={up ? 'text-bull' : 'text-bear'}>{formatPctSigned(d.dayChangePct)}</span>
				</div>
			</Html>
		</group>
	);
}

function Ground({ radius }: { radius: number }) {
	const size = Math.ceil((radius + 16) * 2);
	return (
		<group>
			<mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
				<circleGeometry args={[radius + 16, 64]} />
				<meshStandardMaterial color="#06090e" roughness={0.95} metalness={0.05} />
			</mesh>
			<gridHelper args={[size, Math.round(size / 1.7), '#1c2632', '#0f151d']} position={[0, 0.005, 0]} />
		</group>
	);
}

/* ── scene ────────────────────────────────────────────────────────────────── */

function City({ layout, selectedId, onSelect }: { layout: CityLayout; selectedId: string | null; onSelect: (id: string | null) => void }) {
	const [hoveredId, setHoveredId] = React.useState<string | null>(null);

	React.useEffect(() => {
		document.body.style.cursor = hoveredId ? 'pointer' : '';
		return () => {
			document.body.style.cursor = '';
		};
	}, [hoveredId]);

	return (
		<group>
			<Ground radius={layout.radius} />
			{layout.districts.map((d) => (
				<group key={`${d.assetClass}-${d.sector}`}>
					<DistrictPad d={d} />
					<WeatherSystem d={d} />
					{d.buildings.map((b) => (
						<Building
							key={b.holding.id}
							spec={b}
							active={hoveredId === b.holding.id}
							selected={selectedId === b.holding.id}
							onHover={setHoveredId}
							onSelect={onSelect}
						/>
					))}
				</group>
			))}
		</group>
	);
}

export interface CitySceneProps {
	layout: CityLayout;
	selectedId: string | null;
	onSelect: (id: string | null) => void;
	autoRotate: boolean;
}

export function CityScene({ layout, selectedId, onSelect, autoRotate }: CitySceneProps) {
	// Frame the camera from the first layout; later re-allocations keep the user's view.
	const initialRadius = React.useRef(layout.radius).current;
	const r = Math.max(10, initialRadius);

	return (
		<Canvas
			dpr={[1, 1.75]}
			gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
			camera={{ position: [r * 1.3, r * 1.25, r * 1.95], fov: 38, near: 0.5, far: 900 }}
			onPointerMissed={() => onSelect(null)}
		>
			<fogExp2 attach="fog" args={['#05070a', 0.0095]} />
			<hemisphereLight args={['#8fb0e0', '#141a24', 1.7]} />
			<directionalLight position={[20, 32, 14]} intensity={1.6} color="#c2d2ff" />
			<Stars radius={160} depth={60} count={1800} factor={4} saturation={0} fade speed={0.4} />

			<City layout={layout} selectedId={selectedId} onSelect={onSelect} />

			{/* The camera orbits outside the city's bounding circle and never drops to
			    street level, so no building can ever intersect the near plane. */}
			<OrbitControls
				makeDefault
				enablePan={false}
				enableDamping
				dampingFactor={0.07}
				target={[0, 1.8, 0]}
				minDistance={layout.radius * 1.15}
				maxDistance={layout.radius * 4.2}
				minPolarAngle={0.2}
				maxPolarAngle={1.32}
				autoRotate={autoRotate}
				autoRotateSpeed={0.45}
			/>
		</Canvas>
	);
}
