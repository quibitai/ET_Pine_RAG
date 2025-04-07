// Simple script to check database schema and add corState column if missing
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

async function main() {
  // Connect to the database
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL
  });
  
  try {
    console.log('Connecting to database...');
    
    // Check if corState column exists in Message_v2 table
    const checkResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Message_v2' AND column_name = 'corState'
    `);
    
    if (checkResult.rows.length === 0) {
      console.log('corState column not found in Message_v2 table. Adding it now...');
      
      // Add the corState column
      await pool.query(`
        ALTER TABLE "Message_v2" ADD COLUMN "corState" json
      `);
      
      console.log('Successfully added corState column to Message_v2 table.');
    } else {
      console.log('corState column already exists in Message_v2 table.');
    }
    
    // Show full table structure for verification
    console.log('\nCurrent structure of Message_v2 table:');
    const tableInfo = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'Message_v2'
      ORDER BY ordinal_position
    `);
    
    tableInfo.rows.forEach(row => {
      console.log(`${row.column_name} (${row.data_type}) ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

main(); 