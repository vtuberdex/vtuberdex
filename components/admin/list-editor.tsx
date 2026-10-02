'use client';
/**
 * Editor genérico de listas ordenadas (perfil, atributos, habilidades, redes).
 *
 * Las cuatro listas del mantenedor comparten la misma mecánica —agregar, quitar,
 * subir y bajar— y solo cambia el contenido de cada fila, así que la mecánica vive
 * aquí y cada sección aporta `renderItem`. El orden importa: el servidor guarda la
 * posición de cada elemento y los arrays REEMPLAZAN la lista completa, por eso el
 * reordenamiento es explícito (botones) y no un arrastre que se pueda soltar mal.
 */
import type { ReactNode } from 'react';

import { ghostButton } from '@/components/admin/ui';

export interface ListEditorProps<T> {
  /** Nombre en singular, usado en los `aria-label` de los botones («Quitar habilidad 2»). */
  noun: string;
  items: T[];
  onChange: (items: T[]) => void;
  newItem: () => T;
  renderItem: (item: T, update: (patch: Partial<T>) => void, index: number) => ReactNode;
  addLabel: string;
  emptyText: string;
  /** Tope de filas: el servidor también lo impone, aquí solo se deshabilita «Agregar». */
  max?: number;
}

export function ListEditor<T>({ noun, items, onChange, newItem, renderItem, addLabel, emptyText, max }: ListEditorProps<T>) {
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {items.length === 0 && <p className="rounded-xl border border-dashed border-dex-line px-4 py-6 text-center text-sm text-dex-muted">{emptyText}</p>}
      <ol className="space-y-3">
        {items.map((item, index) => (
          <li key={index} className="rounded-xl border border-dex-line bg-dex-void/40 p-3" data-testid="list-row">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] text-dex-muted">
                {noun} {index + 1}
              </span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  className={ghostButton}
                  aria-label={`Subir ${noun} ${index + 1}`}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={ghostButton}
                  aria-label={`Bajar ${noun} ${index + 1}`}
                  disabled={index === items.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={`${ghostButton} hover:!text-red-300`}
                  aria-label={`Quitar ${noun} ${index + 1}`}
                  onClick={() => onChange(items.filter((_, i) => i !== index))}
                >
                  Quitar
                </button>
              </span>
            </div>
            {renderItem(item, (patch) => onChange(items.map((current, i) => (i === index ? { ...current, ...patch } : current))), index)}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className={ghostButton}
        disabled={max !== undefined && items.length >= max}
        onClick={() => onChange([...items, newItem()])}
      >
        + {addLabel}
      </button>
    </div>
  );
}
