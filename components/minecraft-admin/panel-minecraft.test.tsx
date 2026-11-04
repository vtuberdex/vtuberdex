import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MinecraftAdminPage, { metadata } from "../../app/minecraft-admin/page";

describe("/minecraft-admin", () => {
  it("renderiza el listado de plugins, la subida y el editor de configuración", () => {
    const html = renderToStaticMarkup(<MinecraftAdminPage />);
    expect(html).toContain("Mantenedor de Minecraft");
    expect(html).toContain("Plugins instalados");
    expect(html).toContain("Subir plugin");
    expect(html).toContain("Subir .jar");
    expect(html).toContain("server.properties");
    expect(html).toContain("Guardar configuración");
  });

  it("no se indexa y la ruta pública es /minecraft-admin", () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
    expect(metadata.title).toContain("Minecraft");
  });
});
