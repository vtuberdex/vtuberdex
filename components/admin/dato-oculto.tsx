'use client';
/**
 * Datos personales OCULTOS por defecto en el mantenedor (correos, nombre civil).
 *
 * POR QUÉ: el mantenedor se usa en directo (streaming). Un correo a la vista en la cabecera, en el
 * contacto de una solicitud o en la actividad reciente basta para doxxear a alguien sin querer.
 * Todo nace oculto y se revela UNO a UNO con «Mostrar»; al volver a montar la pantalla, vuelve a
 * ocultarse (el estado no se guarda en ningún sitio a propósito).
 *
 * La máscara tiene SIEMPRE el mismo largo: una máscara que copiara la longitud (o la primera letra, o
 * el dominio) ya daría pistas de quién es.
 */
import { useState, type ReactNode } from 'react';

import { ghostButton, inputClass } from '@/components/admin/ui';

export const MASCARA_CORREO = '••••••@••••';
const MASCARA_TEXTO = '••••••••';

const botonChico = 'ml-1.5 rounded border border-dex-line px-1.5 py-0 text-[10px] uppercase tracking-[0.08em] text-dex-muted hover:text-dex-ink';

/** ¿Parece un correo? Lo que no lo parece (un usuario «admin») se muestra tal cual. */
export const pareceCorreo = (texto: string | null | undefined) => /\S+@\S+/.test(texto ?? '');

/**
 * Un dato que se ve como máscara hasta pulsar «Mostrar». `children` permite revelar algo con formato
 * (un enlace `mailto:`) en vez del texto plano.
 */
export function DatoOculto({ valor, etiqueta = 'correo', children }: { valor: string; etiqueta?: string; children?: ReactNode }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="inline-flex items-baseline" data-testid="dato-oculto">
      {visible ? (children ?? <span className="break-all">{valor}</span>) : <span aria-label={`${etiqueta} oculto`}>{pareceCorreo(valor) ? MASCARA_CORREO : MASCARA_TEXTO}</span>}
      {/* aria-label explícito: dentro de un <label> el botón heredaría como nombre todo el texto de la etiqueta. */}
      <button type="button" className={botonChico} aria-pressed={visible} aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${etiqueta}`} onClick={() => setVisible(!visible)}>
        {visible ? 'Ocultar' : 'Mostrar'}
      </button>
    </span>
  );
}

/** Texto que PUEDE ser un correo (el actor de un cambio, quien resolvió una solicitud): solo se oculta si lo es. */
export function QuizasCorreo({ texto }: { texto: string }) {
  return pareceCorreo(texto) ? <DatoOculto valor={texto} /> : <>{texto}</>;
}

/**
 * Campo de correo editable que nace oculto si ya tiene valor: se ve la máscara y «Mostrar y editar».
 * Vacío no hay nada que ocultar y se escribe directo; lo que se escribe a mano se ve (es deliberado).
 */
export function CampoCorreoOculto({
  valor,
  onChange,
  etiqueta,
  placeholder,
}: {
  valor: string;
  onChange: (valor: string) => void;
  etiqueta: string;
  placeholder?: string;
}) {
  // Se oculta lo que YA venía guardado al abrir; si nació vacío, lo que se escribe se queda a la vista
  // (con `valor && !visible` el campo se escondía al teclear la primera letra).
  const [visible, setVisible] = useState(() => !valor);
  if (valor && !visible) {
    return (
      <span className="flex w-full items-center gap-2" data-testid="correo-oculto">
        <span className={`${inputClass} mt-0! flex-1 text-dex-muted`} aria-label={`${etiqueta} oculto`}>
          {MASCARA_CORREO}
        </span>
        {/* aria-label explícito: el campo va dentro de un <label> (Field) que, si no, le daría su texto como nombre. */}
        <button type="button" className={ghostButton} aria-label={`Mostrar y editar ${etiqueta.toLowerCase()}`} onClick={() => setVisible(true)}>
          Mostrar y editar
        </button>
      </span>
    );
  }
  return (
    <span className="flex w-full items-center gap-2">
      <input
        type="email"
        autoComplete="off"
        aria-label={etiqueta}
        value={valor}
        onChange={(event) => onChange(event.target.value)}
        className={`${inputClass} mt-0! w-full`}
        placeholder={placeholder}
      />
      {valor && (
        <button type="button" className={ghostButton} aria-label={`Ocultar ${etiqueta.toLowerCase()}`} onClick={() => setVisible(false)}>
          Ocultar
        </button>
      )}
    </span>
  );
}
