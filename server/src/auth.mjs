/**
 * Autenticación del mantenedor.
 *
 * El sitio original no tiene backend ni panel: editar una carta es tocar HTML a
 * mano. Aquí hay un login real sobre `admin_user` con hash scrypt (sin
 * dependencias externas) y tokens de sesión en memoria.
 */
import crypto from 'node:crypto';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/** Hash `scrypt` con sal aleatoria: `scrypt$<sal>$<derivado>`. */
export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

/** Comparación en tiempo constante. */
export function verifyPassword(password, stored) {
  const [scheme, salt, expected] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createSessionStore({ ttlMs = SESSION_TTL_MS } = {}) {
  const sessions = new Map();

  return {
    issue(user) {
      const token = crypto.randomBytes(32).toString('base64url');
      sessions.set(token, { user, expiresAt: Date.now() + ttlMs });
      return token;
    },
    read(token) {
      const session = sessions.get(token);
      if (!session) return null;
      if (session.expiresAt < Date.now()) {
        sessions.delete(token);
        return null;
      }
      return session.user;
    },
    revoke(token) {
      return sessions.delete(token);
    },
    clear() {
      sessions.clear();
    },
    get size() {
      return sessions.size;
    },
  };
}

/** Middleware de Express: exige sesión válida en rutas de escritura. */
export function requireSession(sessions) {
  return (req, res, next) => {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const user = token ? sessions.read(token) : null;
    if (!user) {
      res.status(401).json({ error: 'no_autenticado' });
      return;
    }
    req.user = user;
    req.sessionToken = token;
    next();
  };
}
