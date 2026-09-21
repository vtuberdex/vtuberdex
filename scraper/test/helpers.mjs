/** Re-exporta la normalización del servidor para comparar implementaciones. */
import { normalizeText } from '../../server/src/text.mjs';

export function buildFtsQueryEquivalent(value) {
  return normalizeText(value);
}
