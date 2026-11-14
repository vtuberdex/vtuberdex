// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
import type { EditorForm } from "@/components/admin/form-model";
import type { FactionRow } from "@/lib/types";

/** Lo que recibe cada paso del asistente: el formulario compartido y cómo cambiarlo. */
export interface StepProps {
  form: EditorForm;
  set: <K extends keyof EditorForm>(key: K, value: EditorForm[K]) => void;
  /**
   * Catálogo de facciones con su madre. Lo necesitan los pasos que deciden algo por facción
   * (el de habilidades: una subfacción acredita los estados de su madre). Opcional para no
   * obligar a los pasos que no lo usan.
   */
  factions?: FactionRow[];
}
