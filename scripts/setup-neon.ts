/**
 * Apply the Health Tracker SQL schema to a Neon Postgres database.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/setup-neon.ts
 * or (plain node with the built .js):
 *   DATABASE_URL=postgresql://... node --loader tsx scripts/setup-neon.ts
 *
 * The script is idempotent-ish: it splits the schema into statements and
 * runs them in order. Tables that already exist are skipped with a notice
 * so re-running after a partial failure is safe.
 */

import { readFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';
import path from 'node:path';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required.');
  console.error('Get it from https://console.neon.tech → your project → Connection string');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

/**
 * Naive statement splitter that understands $$ dollar-quoted bodies and
 * single-quoted strings, so semicolons inside function bodies don't break
 * the split. (Our schema has no functions yet, but this keeps it safe.)
 */
function splitStatements(input: string): string[] {
  const out: string[] = [];
  let buf = '';
  let i = 0;
  while (i < input.length) {
    const ch = input[i];

    // -- line comment
    if (ch === '-' && input[i + 1] === '-') {
      while (i < input.length && input[i] !== '\n') i++;
      continue;
    }
    // 'single quoted string'
    if (ch === "'") {
      buf += ch;
      i++;
      while (i < input.length) {
        buf += input[i];
        if (input[i] === "'") {
          if (input[i + 1] === "'") {
            buf += input[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // $$ dollar-quoted body $$
    if (ch === '$' && input[i + 1] === '$') {
      const end = input.indexOf('$$', i + 2);
      if (end === -1) {
        buf += input.slice(i);
        break;
      }
      buf += input.slice(i, end + 2);
      i = end + 2;
      continue;
    }
    if (ch === ';') {
      out.push(buf.trim());
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter((s) => s.length > 0);
}

async function main() {
  const schemaPath = path.join(process.cwd(), 'api', 'lib', 'schema.sql');
  const raw = await readFile(schemaPath, 'utf8');
  const statements = splitStatements(raw);

  console.log(`Read ${statements.length} statements from api/lib/schema.sql`);
  console.log('Applying to Neon…\n');

  let ok = 0;
  let skipped = 0;

  for (const stmt of statements) {
    // Describe what we're about to run for readable progress output.
    const label = stmt.split('\n')[0]!.slice(0, 72);
    try {
      await sql.query(stmt);
      ok++;
      console.log(`  ✓ ${label}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/already exists/i.test(msg)) {
        skipped++;
        console.log(`  ~ skipped (already exists): ${label}`);
      } else {
        console.error(`  ✗ ${label}`);
        console.error(`    ${msg}`);
        // Keep going so one bad statement doesn't hide the rest, but
        // remember that we failed.
        ok--;
      }
    }
  }

  console.log(`\nDone. ${ok} applied, ${skipped} already present.`);

  // Verify by listing the tables we expect.
  const rows = await sql.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`,
  );
  console.log('\nTables now in the database:');
  for (const r of rows) console.log(`  - ${r.table_name}`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
