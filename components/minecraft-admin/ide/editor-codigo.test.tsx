/** Monaco se carga del propio sitio y Ctrl+S guarda. `@monaco-editor/react` es un doble. */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Arreglo y no `vi.fn()`: la configuración se hace al importar, antes de que el `beforeEach` global
// limpie los dobles.
const { configs, comandos } = vi.hoisted(() => ({
  configs: [] as unknown[],
  comandos: [] as Array<{ tecla: number; fn: () => void }>,
}));

vi.mock("@monaco-editor/react", () => ({
  loader: { config: (c: unknown) => configs.push(c) },
  default: (props: {
    path: string;
    defaultValue: string;
    defaultLanguage: string;
    onChange: (v?: string) => void;
    onMount: (editor: unknown, monaco: unknown) => void;
  }) => {
    props.onMount(
      { addCommand: (tecla: number, fn: () => void) => comandos.push({ tecla, fn }) },
      { KeyMod: { CtrlCmd: 2048 }, KeyCode: { KeyS: 49 } },
    );
    return (
      <textarea
        aria-label={`${props.path} (${props.defaultLanguage})`}
        defaultValue={props.defaultValue}
        onChange={(e) => props.onChange(e.target.value)}
      />
    );
  },
}));

import { EditorCodigo } from "./editor-codigo";

describe("EditorCodigo", () => {
  it("usa /monaco/vs, avisa los cambios y guarda con Ctrl+S", () => {
    const alCambiar = vi.fn();
    const alGuardar = vi.fn();
    render(<EditorCodigo ruta="a.yml" valorInicial="x: 1" lenguaje="yaml" alCambiar={alCambiar} alGuardar={alGuardar} />);
    expect(configs).toContainEqual({ paths: { vs: "/monaco/vs" } });
    fireEvent.change(screen.getByLabelText("a.yml (yaml)"), { target: { value: "x: 2" } });
    expect(alCambiar).toHaveBeenCalledWith("x: 2");
    expect(comandos[0].tecla).toBe(2048 | 49);
    comandos[0].fn();
    expect(alGuardar).toHaveBeenCalled();
  });
});
