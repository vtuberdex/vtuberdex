import type { EditorForm } from '@/components/admin/form-model';

/** Lo que recibe cada paso del asistente: el formulario compartido y cómo cambiarlo. */
export interface StepProps {
  form: EditorForm;
  set: <K extends keyof EditorForm>(key: K, value: EditorForm[K]) => void;
}
