// Test harness: runs the REAL migrations in an in-memory Postgres (PGlite) with a tiny
// stand-in for Supabase's `auth` schema, then lets tests act as different users.
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

const SUPABASE_STUB = `
  create schema auth;
  create schema extensions;
  create table auth.users (id uuid primary key, email text);
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  -- same behaviour as Supabase: auth.uid() reads the JWT subject
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, extensions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;

export async function createDb() {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec('create extension if not exists pg_trgm;'); // loads the extension files into the engine
  await db.exec('drop extension pg_trgm;');
  await db.exec(SUPABASE_STUB);
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    try {
      await db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${e.message}`);
    }
  }

  /** Run SQL as the database owner (like the service key: bypasses RLS, no user). */
  const admin = (sql, params) => db.query(sql, params).then((r) => r.rows);

  /** Run SQL as a signed-in user (role `authenticated`, JWT subject = userId). */
  const as = async (userId, sql, params) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
    try {
      return (await db.query(sql, params)).rows;
    } finally {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
    }
  };

  /** Run SQL as a logged-out visitor (role `anon`). */
  const anon = async (sql, params) => {
    await db.exec(`set role anon;`);
    try {
      return (await db.query(sql, params)).rows;
    } finally {
      await db.exec(`reset role;`);
    }
  };

  return { db, admin, as, anon };
}
