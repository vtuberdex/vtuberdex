/**
 * «hace 5 min», «hace 3 h», «hace 2 d»: lo que se lee de un vistazo en una cola de trabajo.
 * Pasada una semana se muestra la fecha, porque «hace 40 d» obliga a calcular.
 */
export function haceCuanto(iso: string, ahora: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((ahora - t) / 1000));
  if (s < 45) return 'hace un momento';
  const min = Math.round(s / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d <= 7) return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
  return `el ${new Date(t).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
