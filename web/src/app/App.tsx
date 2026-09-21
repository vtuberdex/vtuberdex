import { Suspense, lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { AppHeader } from './AppHeader';

// El detalle arrastra three.js: se carga solo cuando se visita una ficha.
const DetailPage = lazy(() => import('../features/detail/DetailPage'));
const CatalogPage = lazy(() => import('../features/catalog/CatalogPage'));
const AdminPage = lazy(() => import('../features/admin/AdminPage'));

function RouteFallback() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-20 text-center font-mono text-sm text-dex-muted">cargando módulo…</div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <div className="dex-grid relative min-h-screen">
        <div className="relative z-10">
          <AppHeader />
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<CatalogPage />} />
              <Route path="/v/:slug" element={<DetailPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route
                path="*"
                element={
                  <div className="mx-auto max-w-xl px-4 py-20 text-center">
                    <h1 className="text-2xl font-extrabold text-dex-ink">Página no encontrada</h1>
                  </div>
                }
              />
            </Routes>
          </Suspense>
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
