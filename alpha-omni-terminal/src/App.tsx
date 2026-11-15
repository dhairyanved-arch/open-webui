import * as React from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { MockDataProvider } from '@/context/MockDataContext';

// Each module is its own chunk, so Three.js and React Flow only load when needed.
const IpoMonteCarlo = React.lazy(() => import('@/modules/ipo/IpoMonteCarlo'));
const VolSurface = React.lazy(() => import('@/modules/volsurface/VolSurface'));
const AlgoBuilder = React.lazy(() => import('@/modules/algo/AlgoBuilder'));
const TapeReader = React.lazy(() => import('@/modules/tape/TapeReader'));
const PortfolioCity = React.lazy(() => import('@/modules/city/PortfolioCity'));

export default function App() {
	return (
		<MockDataProvider>
			<HashRouter>
				<Routes>
					<Route element={<AppShell />}>
						<Route index element={<Navigate to="/ipo" replace />} />
						<Route path="/ipo" element={<IpoMonteCarlo />} />
						<Route path="/vol-surface" element={<VolSurface />} />
						<Route path="/algo-builder" element={<AlgoBuilder />} />
						<Route path="/tape" element={<TapeReader />} />
						<Route path="/portfolio-city" element={<PortfolioCity />} />
						<Route path="*" element={<Navigate to="/ipo" replace />} />
					</Route>
				</Routes>
			</HashRouter>
		</MockDataProvider>
	);
}
