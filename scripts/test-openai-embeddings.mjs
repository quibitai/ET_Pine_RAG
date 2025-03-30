#!/usr/bin/env node

// This script tests OpenAI embeddings with text-embedding-3-large
// Usage: OPENAI_API_KEY=your_key node scripts/test-openai-embeddings.mjs

import OpenAI from 'openai';

// Get the API key from environment
const apiKey = process.env.OPENAI_API_KEY;

// Check if API key is provided
if (!apiKey) {
  console.error('❌ Error: OPENAI_API_KEY environment variable is not set.');
  console.error('Please run with: OPENAI_API_KEY=your_key node scripts/test-openai-embeddings.mjs');
  process.exit(1);
}

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: apiKey,
});

async function testEmbeddings() {
  try {
    console.log('🔄 Testing OpenAI embeddings with text-embedding-3-large...');
    
    // Generate embeddings for a test string
    const response = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: "Hello world, this is a test of the embedding model.",
      encoding_format: "float",
    });
    
    // Get the embedding vector
    const embedding = response.data[0].embedding;
    
    console.log(`✅ Successfully generated embeddings with dimensions: ${embedding.length}`);
    console.log(`✅ First few values: ${embedding.slice(0, 5).map(v => v.toFixed(6)).join(', ')}...`);
    console.log('🎉 OpenAI embeddings are working correctly!');
    
  } catch (error) {
    console.error('❌ Error generating embeddings:', error);
    process.exit(1);
  }
}

// Run the test
testEmbeddings(); 