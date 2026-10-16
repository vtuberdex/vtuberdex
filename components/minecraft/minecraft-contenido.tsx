'use client';

/**
 * Página «Cómo entrar al servidor de Minecraft» (`/minecraft`). Describe el flujo real del plugin: entrar a
 * la casa de espera, `/vtd email` → código al correo de la inscripción → `/vtd codigo`. Los puertos y la
 * dirección son constantes de este archivo (el plugin y la VPS los fijan, ver AGENTS.md «Minecraft»).
 */
import Link from 'next/link';
import { useState } from 'react';

import { useI18n } from '@/lib/i18n';
import type { Clave } from '@/lib/i18n/mensajes';

export const MC_HOST = 'vtuberdex.com';
const PUERTO_JAVA = 25565;
const PUERTO_BEDROCK = 19132;

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-dex-line bg-dex-panel/60 p-5">
      <h2 className="text-lg font-bold text-dex-ink">{titulo}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-dex-ink/85">{children}</div>
    </section>
  );
}

function Comando({ texto }: { texto: string }) {
  return <code className="block overflow-x-auto rounded-lg border border-dex-line bg-dex-void px-3 py-2 font-mono text-xs text-dex-accent">{texto}</code>;
}

/** Copiar con respaldo: sin HTTPS `navigator.clipboard` no existe (misma razón que el botón de donar). */
function BotonCopiar({ texto }: { texto: string }) {
  const { t } = useI18n();
  const [hecho, setHecho] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setHecho(true);
      setTimeout(() => setHecho(false), 2000);
    } catch {
      /* sin portapapeles: la dirección sigue visible para copiarla a mano */
    }
  };
  return (
    <button type="button" onClick={copiar} className="rounded-lg border border-dex-line px-3 py-1.5 text-xs text-dex-muted hover:text-dex-ink">
      {hecho ? t('mc.dir.copiado') : t('mc.dir.copiar')}
    </button>
  );
}

export function MinecraftContenido() {
  const { t } = useI18n();
  const vars = { host: MC_HOST, puertoJava: PUERTO_JAVA, puertoBedrock: PUERTO_BEDROCK };
  const pasos = [1, 2, 3, 4] as const;

  return (
    <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-10 sm:px-6" data-testid="minecraft">
      <header>
        <h1 className="text-2xl font-extrabold text-dex-ink">{t('mc.titulo')}</h1>
        <p className="mt-2 text-sm text-dex-muted">{t('mc.intro')}</p>
      </header>

      <Seccion titulo={t('mc.req.titulo')}>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t('mc.req.1')}</li>
          <li>{t('mc.req.2')}</li>
          <li>{t('mc.req.3')}</li>
        </ul>
        <Link href="/inscripcion" className="inline-block rounded-xl bg-dex-accent px-5 py-2.5 text-sm font-bold text-black">
          {t('mc.req.boton')}
        </Link>
      </Seccion>

      <Seccion titulo={t('mc.dir.titulo')}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dex-line bg-dex-void px-4 py-3">
          <span className="font-mono text-lg text-dex-ink" data-testid="mc-host">{MC_HOST}</span>
          <BotonCopiar texto={MC_HOST} />
        </div>
        <p><strong>{t('mc.dir.java')}:</strong> {t('mc.dir.javaTexto', vars)}</p>
        <p><strong>{t('mc.dir.bedrock')}:</strong> {t('mc.dir.bedrockTexto', vars)}</p>
      </Seccion>

      <Seccion titulo={t('mc.pasos.titulo')}>
        <ol className="space-y-4">
          {pasos.map((n) => (
            <li key={n} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-dex-accent text-sm font-bold text-black" aria-hidden>
                {n}
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <h3 className="font-bold text-dex-ink">{t(`mc.p${n}.t` as Clave)}</h3>
                <p>{t(`mc.p${n}.d` as Clave)}</p>
                {(n === 2 || n === 3) && <Comando texto={t(`mc.p${n}.cmd` as Clave)} />}
                {(n === 2 || n === 3) && <p className="text-xs text-dex-muted">{t(`mc.p${n}.nota` as Clave)}</p>}
                {n === 3 && (
                  <Link href="/mi-ficha" className="text-xs text-dex-accent underline underline-offset-2">
                    {t('niveles.s5.boton')}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Seccion>

      <Seccion titulo={t('mc.cmd.titulo')}>
        <ul className="space-y-1 font-mono text-xs">
          <li>{t('mc.cmd.ficha')}</li>
          <li>{t('mc.cmd.panel')}</li>
          <li>{t('mc.cmd.stats')}</li>
          <li>{t('mc.cmd.desvincular')}</li>
        </ul>
      </Seccion>

      <Seccion titulo={t('mc.reglas.titulo')}>
        <ul className="list-disc space-y-2 pl-5">
          <li>{t('mc.reglas.1')}</li>
          <li>{t('mc.reglas.2')}</li>
          <li>{t('mc.reglas.3')}</li>
          <li>{t('mc.reglas.4')}</li>
        </ul>
      </Seccion>

      <Seccion titulo={t('mc.faq.titulo')}>
        <dl className="space-y-3">
          {([1, 2, 3] as const).map((n) => (
            <div key={n}>
              <dt className="font-bold text-dex-ink">{t(`mc.faq.q${n}` as Clave)}</dt>
              <dd className="mt-0.5">{t(`mc.faq.a${n}` as Clave)}</dd>
            </div>
          ))}
        </dl>
      </Seccion>

      <Link href="/" className="inline-block text-sm text-dex-accent underline underline-offset-2">
        {t('mc.volver')}
      </Link>
    </main>
  );
}
