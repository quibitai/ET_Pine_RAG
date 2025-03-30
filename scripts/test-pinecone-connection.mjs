#!/usr/bin/env node

/**
 * Test script for diagnosing Pinecone connection issues
 * 
 * This script tests the Pinecone connection directly, bypassing the Next.js API
 * to help isolate the source of timeout issues.
 * 
 * Usage:
 *   node scripts/test-pinecone-connection.mjs
 */

import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';
import { performance } from 'perf_hooks';

// Load environment variables
dotenv.config();

const INDEX_NAME = process.env.PINECONE_INDEX_NAME;
const API_KEY = process.env.PINECONE_API_KEY;
const INDEX_HOST = process.env.PINECONE_INDEX_HOST || 'https://et-mf0m9e4.svc.aped-4627-b74a.pinecone.io';

// Validate required environment variables
if (!API_KEY) {
  console.error('❌ Error: PINECONE_API_KEY environment variable is not defined');
  process.exit(1);
}

if (!INDEX_NAME) {
  console.error('❌ Error: PINECONE_INDEX_NAME environment variable is not defined');
  process.exit(1);
}

console.log('\n🔍 Pinecone Connection Test');
console.log('==========================');
console.log(`INDEX_NAME: ${INDEX_NAME}`);
console.log(`INDEX_HOST: ${INDEX_HOST}`);
console.log(`API_KEY present: ${!!API_KEY}`);
console.log('==========================\n');

// Test 1: Initialize Pinecone client
console.log('Test 1: Initialize Pinecone client');
let pineconeClient;
try {
  console.time('Initialize Pinecone client');
  const startInit = performance.now();
  
  pineconeClient = new Pinecone({
    apiKey: API_KEY,
  });
  
  const endInit = performance.now();
  console.timeEnd('Initialize Pinecone client');
  console.log(`✅ Client initialized successfully (${Math.round(endInit - startInit)}ms)\n`);
} catch (error) {
  console.error('❌ Error initializing Pinecone client:', error);
  process.exit(1);
}

// Test 2: Get index
console.log('Test 2: Get Pinecone index');
let pineconeIndex;
try {
  console.time('Get Pinecone index');
  const startGetIndex = performance.now();
  
  pineconeIndex = pineconeClient.index(INDEX_NAME);
  
  const endGetIndex = performance.now();
  console.timeEnd('Get Pinecone index');
  console.log(`✅ Index accessed successfully (${Math.round(endGetIndex - startGetIndex)}ms)\n`);
} catch (error) {
  console.error('❌ Error getting Pinecone index:', error);
  process.exit(1);
}

// Test 3: Describe index
console.log('Test 3: Describe index');
try {
  console.time('Describe index');
  const startDescribe = performance.now();
  
  const description = await pineconeIndex.describeIndexStats();
  
  const endDescribe = performance.now();
  console.timeEnd('Describe index');
  
  console.log('Index statistics:');
  console.log(`- Namespace count: ${description.namespaces ? Object.keys(description.namespaces).length : 0}`);
  console.log(`- Total vector count: ${description.totalVectorCount}`);
  console.log(`- Dimensions: ${description.dimension}`);
  console.log(`✅ Index described successfully (${Math.round(endDescribe - startDescribe)}ms)\n`);
} catch (error) {
  console.error('❌ Error describing index:', error);
  console.error('Error details:', error);
}

// Test 4: Query index
console.log('Test 4: Query index with test vector');
try {
  // Create a test vector (3072 dimensions for OpenAI text-embedding-3-large)
  const testVector = new Array(3072).fill(0.1);
  
  console.time('Query index');
  const startQuery = performance.now();
  
  const queryResponse = await pineconeIndex.query({
    vector: testVector,
    topK: 5,
    includeMetadata: true
  });
  
  const endQuery = performance.now();
  console.timeEnd('Query index');
  
  const matches = queryResponse.matches?.length || 0;
  console.log(`- Found ${matches} matching vectors`);
  console.log(`✅ Query completed successfully (${Math.round(endQuery - startQuery)}ms)\n`);
  
  // Display match details if any
  if (matches > 0) {
    console.log('Top match details:');
    const topMatch = queryResponse.matches[0];
    console.log(`- ID: ${topMatch.id}`);
    console.log(`- Score: ${topMatch.score}`);
    console.log(`- Metadata: ${JSON.stringify(topMatch.metadata)}`);
  }
} catch (error) {
  console.error('❌ Error querying index:', error);
  console.error('Error details:', error);
}

console.log('\n✅ Pinecone connection test completed successfully\n'); 