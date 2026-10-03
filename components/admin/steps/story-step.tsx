'use client';
/** Paso 4: historia — frase, lore y datos de perfil con atajos. */
import { useState } from 'react';
import { camposDerivados, fundirPerfil, parsearDatos } from '@/components/admin/pegar-datos';
import { ProfileEditor } from '@/components/admin/list-sections';
import { PROFILE_SUGGESTIONS } from '@/components/admin/suggestions';
import type { StepProps } from '@/components/admin/steps/types';
import { Field, ghostButton, inputClass } from '@/components/admin/ui';

const LORE_MAX = 4000;

export function StoryStep({ form, set }: StepProps) {
  const [modo, setModo] = useState<'manual' | 'pegar'>('manual');
  const [html, setHtml] = useState('');
  const [aviso, setAviso] = useState('');
  const aplicar = () => {
    const nuevos = parsearDatos(html);
    if (nuevos.length === 0) {
      setAviso('No encontré bloques <div class="dato"> con título y contenido.');
      return;
    }
    const perfil = fundirPerfil(form.profile, nuevos);
    set('profile', perfil);
    const derivados = camposDerivados(nuevos);
    if (derivados.birthday) set('birthday', derivados.birthday);
    if (derivados.height) set('height', derivados.height);
    if (derivados.hashtag) set('hashtag', derivados.hashtag);
    if (derivados.favoriteColor) set('favoriteColor', derivados.favoriteColor);
    setAviso(`Se aplicaron ${nuevos.length} datos. Revísalos en la pestaña «Manual».`);
    setHtml('');
    setModo('manual');
  };
  const present = new Set(form.profile.map((field) => field.label.trim().toLowerCase()));
  const missing = PROFILE_SUGGESTIONS.filter((label) => !present.has(label.toLowerCase()));
  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <Field label="Frase de presentación" hint="Una línea corta. Ejemplo: «Pixelartista y developer».">
          <textarea value={form.phrase} onChange={(event) => set('phrase', event.target.value)} rows={2} className={inputClass} />
        </Field>
        <Field label="Historia (lore)" hint={`${form.cardText.length} / ${LORE_MAX} caracteres · Cuenta quién es, de dónde viene y qué hace. 3 o 4 frases bastan.`}>
          <textarea value={form.cardText} onChange={(event) => set('cardText', event.target.value)} rows={8} maxLength={LORE_MAX} className={inputClass} />
        </Field>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-bold text-dex-ink">Datos de perfil</h3>
        <div role="tablist" className="flex gap-2">
          {(['manual', 'pegar'] as const).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={modo === id} className={ghostButton} onClick={() => setModo(id)}>
              {id === 'manual' ? 'Manual' : 'Pegar HTML'}
            </button>
          ))}
        </div>
        {aviso && <p role="status" className="text-sm text-dex-muted">{aviso}</p>}
        {modo === 'pegar' && (
          <div className="space-y-2">
            <p className="text-sm text-dex-muted">
              Pega los bloques <code>&lt;div class=&quot;dato&quot;&gt;…</code>. Los datos con el mismo nombre se actualizan; los nuevos se añaden.
            </p>
            <textarea value={html} onChange={(event) => setHtml(event.target.value)} rows={10} className={inputClass} aria-label="HTML de datos" />
            <button type="button" className={ghostButton} onClick={aplicar} disabled={!html.trim()}>
              Procesar y agregar
            </button>
          </div>
        )}
        {modo === 'manual' && <p className="text-sm text-dex-muted">Un clic añade un campo sugerido; después escribe su valor.</p>}
        {modo === 'manual' && missing.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Campos sugeridos">
            {missing.map((label) => (
              <li key={label}>
                <button type="button" className={ghostButton} onClick={() => set('profile', [...form.profile, { label, value: '' }])}>
                  + {label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {modo === 'manual' && <ProfileEditor items={form.profile} onChange={(next) => set('profile', next)} />}
      </section>
    </div>
  );
}
