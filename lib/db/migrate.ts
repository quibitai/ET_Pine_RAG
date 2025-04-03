import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as fs from 'fs';
import * as path from 'path';

config({
  path: '.env.local',
});

const runMigrate = async () => {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is not defined');
  }

  const connection = postgres(process.env.POSTGRES_URL, { max: 1 });
  const db = drizzle(connection);

  console.log('⏳ Running migrations...');

  // First, run normal migrations
  await migrate(db, { migrationsFolder: './lib/db/migrations' });

  // Then run our custom migration to add timestamp columns
  const customMigrationPath = path.join(process.cwd(), 'lib/db/migrations-custom/0008_add_missing_timestamp_columns.sql');
  if (fs.existsSync(customMigrationPath)) {
    console.log('⏳ Running custom timestamp migration...');
    try {
      const sql = fs.readFileSync(customMigrationPath, 'utf8');
      await connection.unsafe(sql);
      console.log('✅ Custom timestamp migration completed');
    } catch (error) {
      console.error('❌ Custom migration failed');
      console.error(error);
    }
  }

  await connection.end();
  console.log('✅ Migrations completed');
};

runMigrate().catch((err) => {
  console.error('❌ Migration failed');
  console.error(err);
  process.exit(1);
}); 