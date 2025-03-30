#!/usr/bin/env node

// This script tests connectivity to the Replicate API
// Usage: REPLICATE_API_TOKEN=your_token node scripts/test-replicate-token.mjs

// Get the token from environment or argument
const token = process.env.REPLICATE_API_TOKEN;

// Check if token is provided
if (!token) {
  console.error('❌ Error: REPLICATE_API_TOKEN environment variable is not set.');
  console.error('Please run with: REPLICATE_API_TOKEN=your_token node scripts/test-replicate-token.mjs');
  process.exit(1);
}

// Print token first few chars for verification
console.log(`🔑 Using token beginning with: ${token.substring(0, 4)}...`);

async function testReplicateToken() {
  try {
    console.log('🔄 Testing Replicate API connection...');
    
    // Simple API call to list models
    const response = await fetch('https://api.replicate.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json',
      },
    });
    
    console.log(`📊 Response status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`❌ API error response: ${errorBody}`);
      console.error('Token is invalid or has insufficient permissions.');
      process.exit(1);
    }
    
    const data = await response.json();
    console.log(`✅ API connection successful! Retrieved ${data.results?.length || 0} models.`);
    
    // Now test connectivity to the specific model we're using
    console.log('\n🔄 Testing access to Llama-text-embed-v2 model...');
    const modelVersion = "2de20570000f33c0cc65a27da2bb378bca4eee48b22fc7b0c0ad0b30e1d7241d";
    
    // Create a simple prediction with minimal text
    const predictionResponse = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: modelVersion,
        input: {
          text: "Hello world",
        },
      }),
    });
    
    console.log(`📊 Model test response: ${predictionResponse.status} ${predictionResponse.statusText}`);
    
    if (!predictionResponse.ok) {
      const modelErrorBody = await predictionResponse.text();
      console.error(`❌ Model test error: ${modelErrorBody}`);
      console.error('Cannot access the Llama-text-embed-v2 model. Check token permissions or model availability.');
      process.exit(1);
    }
    
    const predictionData = await predictionResponse.json();
    console.log(`✅ Model access successful! Prediction ID: ${predictionData.id}`);
    console.log('🎉 All tests passed. Your Replicate API token works correctly.');
    
  } catch (error) {
    console.error(`❌ Error during test:`, error);
    process.exit(1);
  }
}

// Run the test
testReplicateToken(); 