/**
 * Sistema de diseño de VTuberDex: los tokens que NO pueden vivir solo en CSS.
 *
 * La web los define en `app/globals.css` (`@theme`, que Tailwind convierte en `bg-dex-*`), pero hay
 * superficies que no leen ese CSS: el correo saliente (estilos en línea, sin variables CSS ni fuentes
 * del proyecto). Este módulo es la copia que esas superficies importan, y `lib/diseno.test.ts` la
 * cruza con `globals.css` para que NO se desfasen: si cambias un color allí, el test falla aquí.
 *
 * Documento humano: `docs/sistema-de-diseno.md`. JS puro, sin imports: lo usa el servidor de correo.
 */
export const DISENO = {
  /** Los siete de `@theme` en `globals.css`, con el mismo nombre sin el prefijo `dex-`. */
  color: {
    void: '#05060a',
    panel: '#0d1017',
    panelSoft: '#141924',
    line: '#232a38',
    ink: '#e8ecf5',
    muted: '#8b96ad',
    accent: '#5eead4',
    /** El segundo resplandor del fondo de la web (`rgb(168 85 247 / .08)`). */
    violeta: '#a855f7',
    /** Semánticos: solo para estados (baja, advertencia, éxito), nunca como decoración. */
    peligro: '#f87171',
    aviso: '#fbbf24',
    exito: '#34d399',
  },
  /** Títulos en Knewave y todo lo demás en Asul; los respaldos son los de la web (`serif`). */
  fuente: {
    titulo: "'Knewave','Asul',Georgia,'Times New Roman',serif",
    texto: "'Asul',Georgia,'Times New Roman',serif",
    /** Única excepción a «todo en Asul»: un código que se copia y pega debe distinguir 0/O y l/1. */
    codigo: "ui-monospace,Menlo,Consolas,'Courier New',monospace",
  },
  /** Hoja de Google Fonts con las dos familias (los clientes que no la cargan usan el respaldo). */
  fuentesUrl: 'https://fonts.googleapis.com/css2?family=Asul:wght@400;700&family=Knewave&display=swap',
  /** Radios en px: tarjeta, botón y cajas internas. */
  radio: { tarjeta: 16, boton: 12, caja: 10 },
};
