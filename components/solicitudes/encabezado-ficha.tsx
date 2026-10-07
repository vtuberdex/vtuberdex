'use client';
/**
 * Encabezado de `/inscripcion` y `/modificacion`. La página es de servidor (metadata en español, la que
 * indexan los buscadores), pero el texto visible tiene que seguir el selector de idioma, que vive en el cliente.
 */
import { useI18n } from '@/lib/i18n';

export function EncabezadoInscripcion() {
  const { t } = useI18n();
  return (
    <>
      <h1 className="text-2xl font-extrabold text-dex-ink">{t('ins.pagTitulo')}</h1>
      <p className="mt-2 mb-8 text-sm text-dex-muted">
        {t('ins.pagTextoA')}
        <strong>{t('ins.pagTextoNegrita')}</strong>
        {t('ins.pagTextoB')}
      </p>
    </>
  );
}

export function EncabezadoModificacion() {
  const { t } = useI18n();
  return (
    <>
      <h1 className="text-2xl font-extrabold text-dex-ink">{t('mod.pagTitulo')}</h1>
      <p className="mt-2 mb-8 text-sm text-dex-muted">{t('mod.pagTexto')}</p>
    </>
  );
}
