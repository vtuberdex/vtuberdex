/**
 * Página del mantenedor.
 *
 * El mantenedor NO puede existir en producción: en Vercel el catálogo es de solo
 * lectura (el sistema de archivos es inmutable y la base viaja empaquetada), así
 * que no hay dónde escribir los cambios. Su API responde 404 allí a propósito.
 *
 * En local sí funciona: `AdminPage` habla con `/api/admin/*`, que Next reenvía al
 * servidor Express (`VTUBERDEX_ADMIN_URL`) levantado por `./scripts/dev-up.sh`.
 * Si esa variable no está, la página carga pero cada llamada da 404 — el mismo
 * comportamiento de producción, que es lo que el verificador del deploy comprueba.
 */
import type { Metadata } from 'next';

import { AdminPage } from '@/components/admin-page';

export const metadata: Metadata = {
  title: 'Mantenedor · VTuberDex',
  robots: { index: false, follow: false },
};

export default function AdminRoute() {
  return <AdminPage />;
}
