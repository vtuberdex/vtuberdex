import { describe, expect, it } from "vitest";

import { safeImageSrc } from "@/components/admin/ui";

describe("safeImageSrc", () => {
  it("acepta rutas del propio sitio (relativas y absolutas)", () => {
    expect(safeImageSrc("/img/logo.png")).toBe("/img/logo.png");
    expect(safeImageSrc("img/logo.png")).toBe("img/logo.png");
    expect(safeImageSrc("./img/logo.png")).toBe("./img/logo.png");
  });

  it("acepta http(s), blob y data:image/*", () => {
    expect(safeImageSrc("https://cdn.example.com/a.png")).toBe(
      "https://cdn.example.com/a.png",
    );
    expect(safeImageSrc("http://cdn.example.com/a.png")).toBe(
      "http://cdn.example.com/a.png",
    );
    expect(safeImageSrc("blob:https://example.com/abc")).toBe(
      "blob:https://example.com/abc",
    );
    expect(safeImageSrc("data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(safeImageSrc("data:image/webp;base64,AAAA")).toBe(
      "data:image/webp;base64,AAAA",
    );
  });

  it("rechaza URLs protocol-relative (//host)", () => {
    expect(safeImageSrc("//evil.example.com/a.png")).toBeNull();
  });

  it("rechaza esquemas desconocidos o peligrosos", () => {
    expect(safeImageSrc("javascript:alert(1)")).toBeNull();
    expect(safeImageSrc("ftp://example.com/a.png")).toBeNull();
    expect(safeImageSrc("mailto:ana@example.com")).toBeNull();
    expect(safeImageSrc("vbscript:msgbox(1)")).toBeNull();
  });

  it("rechaza data: que no sea imagen", () => {
    expect(safeImageSrc("data:text/html;base64,AAAA")).toBeNull();
    expect(safeImageSrc("data:image/svg+xml;base64,AAAA")).toBeNull();
    expect(safeImageSrc("data:application/javascript,alert(1)")).toBeNull();
  });

  it("trata vacío y nulo como sin imagen", () => {
    expect(safeImageSrc(null)).toBeNull();
    expect(safeImageSrc(undefined)).toBeNull();
    expect(safeImageSrc("")).toBeNull();
  });
});
