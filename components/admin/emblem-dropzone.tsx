'use client';
/**
 * Zona para elegir un archivo de emblema: arrastrar y soltar, o botón. Solo entrega el
 * `File`; la conversión a PNG y la subida son de quien la usa, porque aquí no se sabe si
 * el archivo se sube ya (tarjeta existente) o se guarda para después (asistente).
 */
import { useRef, useState } from 'react';

import { ghostButton } from '@/components/admin/ui';

export function EmblemDropzone({
  onFile,
  busy = false,
  label = 'Arrastra aquí tu emblema',
  buttonLabel = 'Elegir archivo',
  inputLabel = 'Archivo del emblema',
}: {
  onFile: (file: File) => void;
  busy?: boolean;
  label?: string;
  buttonLabel?: string;
  inputLabel?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const file = event.dataTransfer.files?.[0];
        if (file && !busy) onFile(file);
      }}
      className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-4 text-center text-xs transition ${
        over ? 'border-dex-accent bg-dex-accent/10 text-dex-ink' : 'border-dex-line text-dex-muted'
      }`}
    >
      <p>{label}</p>
      <input
        ref={input}
        type="file"
        accept="image/*"
        aria-label={inputLabel}
        className="hidden"
        data-testid="emblem-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
      <button type="button" className={ghostButton} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Subiendo…' : buttonLabel}
      </button>
    </div>
  );
}

/** Vista previa local de un archivo elegido (URL de objeto), con limpieza al cambiar. */
export function useObjectUrl(file: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<Blob | null>(null);
  // Se deriva durante el render (patrón de React para estado dependiente de props) y no en un efecto.
  if (file !== lastFile) {
    setLastFile(file);
    if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
    setUrl(file && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null);
  }
  return url;
}
