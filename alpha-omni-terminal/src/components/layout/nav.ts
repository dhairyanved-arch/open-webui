import { Boxes, Building2, ChartScatter, Radio, Workflow, type LucideIcon } from 'lucide-react';

export interface ModuleNavItem {
	path: string;
	index: string;
	label: string;
	caption: string;
	icon: LucideIcon;
}

export const MODULES: ModuleNavItem[] = [
	{ path: '/ipo', index: '01', label: 'IPO Monte Carlo', caption: 'Allotment odds · listing P&L', icon: ChartScatter },
	{ path: '/vol-surface', index: '02', label: 'Volatility Surface', caption: '3D Black-Scholes Greeks', icon: Boxes },
	{ path: '/algo-builder', index: '03', label: 'Algo Builder', caption: 'Node graph → JSON / Python', icon: Workflow },
	{ path: '/tape', index: '04', label: 'Tape Reader', caption: 'Block-deal detection', icon: Radio },
	{ path: '/portfolio-city', index: '05', label: 'Portfolio City', caption: '3D asset allocator', icon: Building2 }
];
