import * as THREE from 'three';
import { GEOMETRY } from './card3d-config';

/**
 * Geometría del CUERPO de la carta: la pieza extruida cuyo canto se ve al inclinarla.
 *
 * POR QUE ESTA AQUI Y NO DENTRO DE holo-card.tsx
 * ----------------------------------------------
 * Estaba en un `useMemo` del componente, y eso la hacía INVISIBLE para el harness: la escena
 * de prueba montaba la cara (un plano) pero no el cuerpo, así que cualquier ajuste del canto
 * —grosor, bisel, radio— se podía cambiar sin que ninguna medición lo notara. Es la misma
 * clase de zona ciega que tuvo `GLOW.strength` con la malla del resplandor.
 *
 * Al vivir aquí, el componente y el harness construyen EXACTAMENTE la misma malla (no una
 * copia que puede divergir), que es lo que hace válida la medición del bisel.
 */
export function buildCardBodyGeometry(): THREE.ExtrudeGeometry {
  const bevelSize = GEOMETRY.cardDepth * GEOMETRY.bevelRatio;
  const r = GEOMETRY.cornerRadius - bevelSize;
  const ancho = GEOMETRY.cardWidth - bevelSize * 2;
  const alto = GEOMETRY.cardWidth * GEOMETRY.aspect - bevelSize * 2;
  const x0 = -ancho / 2;
  const y0 = -alto / 2;

  const shape = new THREE.Shape();
  shape.moveTo(x0 + r, y0);
  shape.lineTo(x0 + ancho - r, y0);
  shape.absarc(x0 + ancho - r, y0 + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(x0 + ancho, y0 + alto - r);
  shape.absarc(x0 + ancho - r, y0 + alto - r, r, 0, Math.PI / 2, false);
  shape.lineTo(x0 + r, y0 + alto);
  shape.absarc(x0 + r, y0 + alto - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(x0, y0 + r);
  shape.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: GEOMETRY.cardDepth,
    bevelEnabled: true,
    bevelThickness: bevelSize,
    bevelSize,
    bevelSegments: GEOMETRY.bevelSegments,
    curveSegments: GEOMETRY.curveSegments,
  });
  geometry.translate(0, 0, -(GEOMETRY.cardDepth / 2 + bevelSize));
  return geometry;
}
