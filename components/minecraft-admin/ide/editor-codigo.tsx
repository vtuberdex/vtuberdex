// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";

/**
 * Monaco (el editor de VS Code) servido desde `/monaco/vs` (ver `scripts/copiar-monaco.mjs`), no
 * desde un CDN. Un modelo por ruta (`path`), así cada pestaña conserva su deshacer y su cursor.
 */
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import { useRef } from "react";

loader.config({ paths: { vs: "/monaco/vs" } });

export function EditorCodigo({
  ruta,
  valorInicial,
  lenguaje,
  alCambiar,
  alGuardar,
}: {
  ruta: string;
  valorInicial: string;
  lenguaje: string;
  alCambiar: (valor: string) => void;
  alGuardar: () => void;
}) {
  const guardarRef = useRef(alGuardar);
  guardarRef.current = alGuardar;

  const alMontar: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => guardarRef.current());
  };

  return (
    <Editor
      path={ruta}
      defaultValue={valorInicial}
      defaultLanguage={lenguaje}
      theme="vs-dark"
      onChange={(v) => alCambiar(v ?? "")}
      onMount={alMontar}
      loading={<p className="p-4 text-xs text-dex-muted">Cargando editor…</p>}
      options={{
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        minimap: { enabled: true },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        tabSize: 2,
        insertSpaces: true,
        renderWhitespace: "boundary",
        wordWrap: "off",
        smoothScrolling: true,
      }}
    />
  );
}
