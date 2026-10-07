'use client';
/**
 * Aviso «Accediendo al detalle»: cubre la pantalla desde que se pulsa una carta hasta que la
 * ficha tiene sus datos (ver `lib/abriendo-detalle.ts`). Vive en el layout para sobrevivir a
 * la navegación.
 */
import { useAbriendoDetalle } from '@/lib/abriendo-detalle';
import { useI18n } from '@/lib/i18n';


export function AbriendoDetalle() {
  const { t } = useI18n();
  const abierto = useAbriendoDetalle();
  if (!abierto) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('abriendo.detalle')}
      data-testid="abriendo-detalle"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div className="flex items-center gap-3 rounded-2xl border border-dex-line bg-dex-panel px-6 py-4 text-dex-ink shadow-2xl">
        <span aria-hidden className="h-5 w-5 animate-spin rounded-full border-2 border-dex-accent/30 border-t-dex-accent" />
        <p role="status" className="text-sm">{t('abriendo.detalle')}</p>
      </div>
    </div>
  );
}

export default AbriendoDetalle;
