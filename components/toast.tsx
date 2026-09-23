'use client';
/**
 * Sistema de toasts ligero para el mantenedor.
 *
 * Por qué no una librería: el proyecto solo necesita un par de avisos breves en
 * el panel de admin. Añadir una dependencia solo por eso es matar una mosca con un
 * cañonazo. Este componente usa React puro, no toca `document.body` (funciona
 * en SSR de Next) y se autodescarta.
 */
import { useEffect, useState, useCallback } from 'react';

export interface ToastItem {
  id: string;
  kind: 'ok' | 'error';
  text: string;
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onRemove: (id: string) => void;
}

const ICON = {
  ok: '✓',
  error: '✕',
};

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  return (
    <div className="fixed right-4 top-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

function Toast({ toast, onRemove }: { toast: ToastItem; onRemove: (id: string) => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Pequeño retardo para que la transición de entrada se vea al montar.
    const enter = setTimeout(() => setVisible(true), 10);
    // La mayoría de las operaciones de imagen tardan >1s; 4s da tiempo a leer.
    const exit = setTimeout(() => setVisible(false), 4000);
    const remove = setTimeout(() => onRemove(toast.id), 4700);
    return () => {
      clearTimeout(enter);
      clearTimeout(exit);
      clearTimeout(remove);
    };
  }, [toast.id, onRemove]);

  const colors =
    toast.kind === 'ok'
      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-100'
      : 'border-red-500/40 bg-red-500/15 text-red-100';

  return (
    <div
      role="status"
      data-testid={`toast-${toast.kind}`}
      className={`flex max-w-xs items-start gap-2 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm transition-all duration-300 ${colors} ${
        visible ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'
      }`}
    >
      <span className="mt-0.5 text-sm font-bold">{ICON[toast.kind]}</span>
      <p className="text-xs leading-snug">{toast.text}</p>
      <button
        type="button"
        aria-label="Cerrar"
        onClick={() => {
          setVisible(false);
          setTimeout(() => onRemove(toast.id), 300);
        }}
        className="ml-1 text-[10px] opacity-60 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

/**
 * Hook para consumir toasts desde cualquier componente de cliente.
 *
 * Devuelve la lista actual, una función para añadir un toast y otra para quitarlo.
 * El id se genera con crypto.randomUUID cuando existe; en tests o entornos antiguos
 * cae a Date.now + Math.random.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const add = useCallback((kind: ToastItem['kind'], text: string) => {
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setToasts((current) => [...current, { id, kind, text }]);
    return id;
  }, []);

  const remove = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  return { toasts, add, remove };
}
