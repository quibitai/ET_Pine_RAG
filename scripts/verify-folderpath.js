// Script to verify the folderPath column in the documents table
const { drizzle } = require('drizzle-orm/postgres-js');
const postgres = require('postgres');
const { sql } = require('drizzle-orm');
const dotenv = require('dotenv');

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

async function main() {
  console.log('Verifying folderPath column in documents table...');
  
  // Get POSTGRES_URL from environment
  const databaseUrl = process.env.POSTGRES_URL;
  if (!databaseUrl) {
    console.error('ERROR: POSTGRES_URL environment variable is not set');
    process.exit(1);
  }
  
  // Connect to database
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);
  
  try {
    // Query to check if column exists
    console.log('Executing SQL query...');
    const result = await db.execute(sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'documents' 
      ORDER BY ordinal_position;
    `);
    
    console.log('Table structure:');
    result.forEach(row => {
      console.log(`- ${row.column_name}: ${row.data_type}`);
    });
    
    // Check specifically for folderPath
    const folderPathColumn = result.find(col => col.column_name === 'folderPath');
    if (folderPathColumn) {
      console.log('\n✅ folderPath column exists with type:', folderPathColumn.data_type);
    } else {
      console.error('\n❌ folderPath column does not exist in the documents table');
    }
  } catch (error) {
    console.error('Error querying database:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main(); 