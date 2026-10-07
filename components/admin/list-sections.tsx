'use client';
/**
 * Las cuatro listas editables de una ficha (perfil, atributos, habilidades y redes).
 * Cada una es un `ListEditor` con su fila; el estado vive en el editor padre para que
 * un único «Guardar cambios» envíe un solo PATCH.
 */
import { SocialIcon } from '@/components/social-icon';
import { ListEditor } from '@/components/admin/list-editor';
import {
  emptySkill,
  emptySocial,
  emptyStat,
  type SkillForm,
  type SocialForm,
  type StatForm,
} from '@/components/admin/form-model';
import { placeholderFor } from '@/components/admin/suggestions';
import { inputClass, labelClass } from '@/components/admin/ui';
import type { ProfileField } from '@/lib/types';

const compact = `${inputClass} !mt-1`;

export function ProfileEditor({ items, onChange }: { items: ProfileField[]; onChange: (items: ProfileField[]) => void }) {
  return (
    <ListEditor
      noun="dato"
      items={items}
      onChange={onChange}
      newItem={() => ({ label: '', value: '' })}
      addLabel="Agregar dato de perfil"
      emptyText="Sin datos de perfil todavía."
      max={40}
      renderItem={(item, update) => (
        <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
          <label className={labelClass}>
            Nombre
            <input value={item.label} onChange={(event) => update({ label: event.target.value })} className={compact} />
          </label>
          <label className={labelClass}>
            Valor
            <input value={item.value} onChange={(event) => update({ value: event.target.value })} className={compact} />
          </label>
        </div>
      )}
    />
  );
}

export function StatsEditor({ items, onChange }: { items: StatForm[]; onChange: (items: StatForm[]) => void }) {
  return (
    <ListEditor
      noun="atributo"
      items={items}
      onChange={onChange}
      newItem={emptyStat}
      addLabel="Agregar atributo"
      emptyText="Sin atributos todavía."
      max={30}
      renderItem={(item, update) => (
        <div className="grid gap-2 sm:grid-cols-4">
          <label className={`${labelClass} sm:col-span-2`}>
            Nombre
            <input value={item.label} onChange={(event) => update({ label: event.target.value })} className={compact} />
          </label>
          <label className={labelClass}>
            Valor
            <input inputMode="numeric" value={item.value} onChange={(event) => update({ value: event.target.value })} className={compact} />
          </label>
          <label className={labelClass}>
            Máximo
            <input inputMode="numeric" value={item.max} onChange={(event) => update({ max: event.target.value })} className={compact} />
          </label>
          <label className={`${labelClass} sm:col-span-4`}>
            Texto del valor (opcional, p. ej. «S+»)
            <input value={item.valueText} onChange={(event) => update({ valueText: event.target.value })} className={compact} />
          </label>
        </div>
      )}
    />
  );
}

const CATEGORIES: Array<{ value: SkillForm['category']; label: string }> = [
  { value: 'active', label: 'Activa' },
  { value: 'passive', label: 'Pasiva' },
  { value: 'ultimate', label: 'Definitiva' },
  { value: 'other', label: 'Otra' },
];

export function SkillsEditor({ items, onChange }: { items: SkillForm[]; onChange: (items: SkillForm[]) => void }) {
  return (
    <ListEditor
      noun="habilidad"
      items={items}
      onChange={onChange}
      newItem={emptySkill}
      addLabel="Agregar habilidad"
      emptyText="Sin habilidades todavía."
      max={30}
      renderItem={(item, update) => (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className={labelClass}>
            Categoría
            <select
              value={item.category}
              onChange={(event) => update({ category: event.target.value as SkillForm['category'] })}
              className={compact}
            >
              {CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Nombre
            <input value={item.name} onChange={(event) => update({ name: event.target.value })} className={compact} />
          </label>
          <label className={labelClass}>
            Sección
            <input value={item.section} onChange={(event) => update({ section: event.target.value })} className={compact} />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Tipo
            <input value={item.type} onChange={(event) => update({ type: event.target.value })} className={compact} />
          </label>
          <label className={`${labelClass} sm:col-span-3`}>
            Efecto
            {/* Reescribir el texto suelta el HTML de ESTA habilidad: el HTML ya no lo describiría. */}
            <textarea rows={3} value={item.effect} onChange={(event) => update({ effect: event.target.value, effectHtml: null })} className={compact} />
            {item.effectHtml && (
              <span className="mt-1 block text-[11px] normal-case tracking-normal text-dex-muted">
                Tiene los estados en sus colores oficiales. Si editas este texto, esta habilidad los pierde: para cambiarla
                sin perderlos, rehaz el kit con el asistente.
              </span>
            )}
          </label>
        </div>
      )}
    />
  );
}

export function SocialsEditor({ items, onChange }: { items: SocialForm[]; onChange: (items: SocialForm[]) => void }) {
  return (
    <ListEditor
      noun="red"
      items={items}
      onChange={onChange}
      newItem={emptySocial}
      addLabel="Agregar red social"
      emptyText="Sin redes sociales todavía."
      max={20}
      renderItem={(item, update) => {
        const bad = item.url.trim() !== '' && !/^https?:\/\/\S+$/i.test(item.url.trim());
        return (
          <div className="grid gap-2 sm:grid-cols-3">
            <label className={labelClass}>
              <span className="inline-flex items-center gap-1.5">
                <SocialIcon platform={item.platform} url={item.url} className="h-3.5 w-3.5" /> Plataforma
              </span>
              <input value={item.platform} onChange={(event) => update({ platform: event.target.value })} className={compact} placeholder="twitch" />
            </label>
            <label className={`${labelClass} sm:col-span-2`}>
              Etiqueta (opcional)
              <input value={item.label} onChange={(event) => update({ label: event.target.value })} className={compact} />
            </label>
            <label className={`${labelClass} sm:col-span-3`}>
              URL
              <input
                value={item.url}
                onChange={(event) => update({ url: event.target.value })}
                aria-invalid={bad}
                className={`${compact} ${bad ? '!border-red-400' : ''}`}
                placeholder={placeholderFor(item.platform)}
              />
              {bad && <span className="mt-1 block text-[11px] normal-case tracking-normal text-red-300">Debe empezar con http:// o https://</span>}
            </label>
          </div>
        );
      }}
    />
  );
}
