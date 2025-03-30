'use server';

// Initialize with Replicate API for Llama-text-embed-v2
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || '';

/**
 * Generates vector embeddings for the given text using Llama-text-embed-v2 via Replicate
 * @param text Text to be embedded
 * @returns A vector of floating point numbers representing the text embedding
 */
export async function generateEmbeddings(text: string): Promise<number[]> {
  try {
    // Ensure the text isn't too long for the embedding model
    const truncatedText = text.slice(0, 10000);
    
    console.log(`Generating embeddings for text (length ${truncatedText.length})`);
    
    // Add debug logging for Replicate API token
    console.log(`Replicate API token is ${REPLICATE_API_TOKEN ? ('present - first 4 chars: ' + REPLICATE_API_TOKEN.substring(0, 4)) : 'MISSING!'}`);
    console.log('Calling Replicate API at: https://api.replicate.com/v1/predictions');
    
    // Ensure we're using the correct model version
    const modelVersion = "2de20570000f33c0cc65a27da2bb378bca4eee48b22fc7b0c0ad0b30e1d7241d"; // Llama-text-embed-v2
    console.log(`Using Llama-text-embed-v2 model version: ${modelVersion}`);
    
    // Pinecone is using Llama-text-embed-v2, so we'll use the same model via Replicate
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: modelVersion,
        input: {
          text: truncatedText,
        },
      }),
    });
    
    // Log response details for debugging
    console.log(`Replicate API response status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Replicate API error response body: ${errorBody}`);
      throw new Error(`Replicate API error: ${response.statusText}`);
    }
    
    const prediction = await response.json();
    console.log('Prediction created, got response:', JSON.stringify(prediction).substring(0, 200) + '...');
    
    // Replicate returns a URL we need to poll for results
    const resultUrl = prediction.urls?.get;
    if (!resultUrl) {
      throw new Error('No result URL returned from Replicate API');
    }
    
    console.log(`Polling results URL: ${resultUrl}`);
    
    // Poll for results
    let embeddings = null;
    let attempts = 0;
    while (embeddings === null && attempts < 20) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      
      console.log(`Polling attempt ${attempts + 1}...`);
      const resultResponse = await fetch(resultUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Token ${REPLICATE_API_TOKEN}`,
        },
      });
      
      console.log(`Poll response status: ${resultResponse.status} ${resultResponse.statusText}`);
      
      if (!resultResponse.ok) {
        const pollErrorBody = await resultResponse.text();
        console.error(`Replicate API poll error response: ${pollErrorBody}`);
        throw new Error(`Replicate API result retrieval error: ${resultResponse.statusText}`);
      }
      
      const result = await resultResponse.json();
      console.log(`Poll result status: ${result.status}`);
      
      if (result.status === 'succeeded') {
        embeddings = result.output;
        break;
      } else if (result.status === 'failed') {
        throw new Error(`Embedding generation failed: ${result.error}`);
      }
      
      attempts++;
    }
    
    if (!embeddings) {
      throw new Error('Timed out waiting for embeddings');
    }
    
    console.log(`Embeddings generated successfully. Dimensions: ${embeddings.length}`);
    
    // Return the embedding vector
    return embeddings;
  } catch (error) {
    console.error('Error generating embeddings:', error);
    // Use a default dimension for Llama embeddings (4096)
    return new Array(4096).fill(0);
  }
} 