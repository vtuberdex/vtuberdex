// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";
/** Paso 7: redes sociales. Antes compartía paso con atributos y habilidades, y quedaba al fondo de una sábana. */
import { useCallback } from "react";

import { SocialsEditor } from "@/components/admin/list-sections";
import { SOCIAL_SHORTCUTS } from "@/components/admin/suggestions";
import type { StepProps } from "@/components/admin/steps/types";
import { ghostButton } from "@/components/admin/ui";

export function SocialsStep({ form, set }: Readonly<StepProps>) {
  // `set` llega estable del asistente (`useCallback`): el editor recibe siempre la misma función.
  const cambiarRedes = useCallback(
    (next: StepProps["form"]["socials"]) => set("socials", next),
    [set],
  );
  return (
    <section className="space-y-3">
      <p className="text-sm text-dex-muted">
        Pulsa una red para añadirla y pega el enlace. Deben empezar con
        https://.
      </p>
      <ul className="flex flex-wrap gap-2" aria-label="Atajos de redes">
        {SOCIAL_SHORTCUTS.map((shortcut) => (
          <li key={shortcut.platform}>
            <button
              type="button"
              className={ghostButton}
              onClick={() =>
                set("socials", [
                  ...form.socials,
                  { platform: shortcut.platform, label: "", url: "", icon: "" },
                ])
              }
            >
              + {shortcut.label}
            </button>
          </li>
        ))}
      </ul>
      <SocialsEditor items={form.socials} onChange={cambiarRedes} />
    </section>
  );
}
