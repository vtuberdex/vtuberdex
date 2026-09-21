/**
 * Crea o restablece el usuario del mantenedor.
 * Uso: node src/create-admin.mjs <usuario> <password>
 */
import { openDatabase } from './db/index.mjs';
import { hashPassword } from './auth.mjs';

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('uso: node src/create-admin.mjs <usuario> <password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('la contraseña debe tener al menos 8 caracteres');
  process.exit(1);
}

const db = openDatabase(process.env.VTUBERDEX_DB);
db.prepare(
  `INSERT INTO admin_user (username, password_hash, role)
   VALUES (?, ?, 'admin')
   ON CONFLICT (username) DO UPDATE SET password_hash = excluded.password_hash`,
).run(username, hashPassword(password));
console.log(`[admin] usuario '${username}' listo`);
db.close();
