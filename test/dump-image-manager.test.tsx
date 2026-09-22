/**
 * SONDA TEMPORAL (no forma parte de la suite): imprime el HTML que el mantenedor
 * pinta para las imágenes de una ficha, para comprobar qué tarjetas existen.
 */
import { render } from '@testing-library/react';
import { test } from 'vitest';

import { ImageManager } from '@/components/image-manager';
import { makeDetail } from '@/test/fixtures';

test('dump', () => {
  const { container } = render(
    <ImageManager
      token="t"
      detail={makeDetail({
        assets: [
          { kind: 'character', path: 'images/character/gkuro.webp', sourceUrl: null, width: 252, height: 373, bytes: 40000 },
          { kind: 'logo', path: 'images/logo/gkuro.webp', sourceUrl: null, width: 744, height: 359, bytes: 29860 },
        ],
      })}
      onUpdated={() => {}}
    />,
  );
  const etiquetas = Array.from(container.querySelectorAll('li span.text-xs.font-bold')).map((n) => n.textContent);
  const inputs = Array.from(container.querySelectorAll('input[type=file]')).map((n) => n.getAttribute('data-testid'));
  const botones = Array.from(container.querySelectorAll('button')).map((n) => n.textContent);
  console.log('SONDA_ETIQUETAS=' + JSON.stringify(etiquetas));
  console.log('SONDA_INPUTS=' + JSON.stringify(inputs));
  console.log('SONDA_BOTONES=' + JSON.stringify(botones));
});
