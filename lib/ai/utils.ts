'use server';

// Import OpenAI for embeddings
import OpenAI from 'openai';
import { generateText } from 'ai';
import { myProvider } from './providers';

// Initialize with OpenAI for text-embedding-3-large
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

/**
 * Enhances a user search query using an LLM to optimize it for web search
 * @param originalQuery The original query from the user
 * @param chatHistory Optional conversation context to improve query enhancement
 * @param systemPrompt Optional system prompt of the calling assistant for context
 * @param ragContext Optional document context from RAG for additional context
 * @returns An enhanced query string optimized for web search
 */
export async function enhanceSearchQuery(
  originalQuery: string,
  chatHistory?: string,
  systemPrompt?: string,
  ragContext?: string
): Promise<string> {
  try {
    const timeLabel = `enhance_search_query_${Date.now()}`;
    console.time(timeLabel);
    console.log(`Enhancing search query: "${originalQuery}"`);
    console.log(`Using system prompt context: ${systemPrompt ? 'Yes' : 'No'}`);
    console.log(`Using RAG context: ${ragContext ? 'Yes (' + ragContext.length + ' chars)' : 'No'}`);
    
    // Construct the prompt for the LLM
    const prompt = `You are an expert research query formulation specialist with deep expertise in information retrieval, search algorithms, and knowledge discovery.

Your task is to transform the user's original query into an optimized search query that will yield the most relevant, authoritative, and comprehensive results.

GOALS:
1. Create a search query that captures the core information need
2. Add precision through specific terminology relevant to the domain
3. Include alternative phrasings for key concepts to expand coverage
4. Incorporate relevant contextual information from provided RAG context
5. Prioritize recency for time-sensitive topics
6. Structure the query for maximum relevance in web search engines

${systemPrompt ? `DOMAIN CONTEXT:\n${systemPrompt.substring(0, 1000)}\n\nThe above context describes the AI assistant's purpose and domain expertise. Use this to inform your query formulation.` : ''}

${ragContext ? `KNOWLEDGE BASE CONTEXT:\n${ragContext.substring(0, 1500)}\n\nThe above contains relevant information from the user's document repository. Incorporate key terms, entities, and concepts from this context into your query if they're relevant to the user's information need.` : ''}

${chatHistory ? `\nCONVERSATION HISTORY:\n${chatHistory}\n\nThe above shows previous exchanges. Use this to maintain continuity and build upon established context.` : ''}

INSTRUCTIONS:
- Analyze the user's query to identify the core information need and subject domain
- Extract key entities, concepts, and relationships
- Add domain-specific terminology that search engines would recognize
- Include synonyms or alternative phrasings for key terms
- Specify recency requirements for time-sensitive topics (e.g., "recent", "2023", "latest")
- Remove unnecessary conversational elements or filler words
- Structure the query to work optimally with search engines
- Output ONLY the enhanced search query, nothing else

Original Query: "${originalQuery}"

Enhanced Query:`;

    // Use a fast model for quick response
    const { text: enhancedQuery } = await generateText({
      model: myProvider.languageModel('openai-chat-model'),
      system: 'You are an expert search query optimizer that transforms user queries for optimal web search results. Return ONLY the enhanced query text with no explanations or additional text.',
      prompt: prompt,
    });

    const cleanedQuery = enhancedQuery.trim().replace(/^["']|["']$/g, ''); // Remove quotes if the model added them
    
    console.log(`Enhanced query: "${cleanedQuery}"`);
    console.timeEnd(timeLabel);
    
    return cleanedQuery;
  } catch (error) {
    // Log error but don't fail - fall back to original query
    console.error('Error enhancing search query:', error);
    console.log('Falling back to original query');
    return originalQuery;
  }
}

/**
 * Generates vector embeddings for the given text using OpenAI text-embedding-3-large
 * @param text Text to be embedded
 * @returns A vector of floating point numbers representing the text embedding
 */
export async function generateEmbeddings(text: string): Promise<number[]> {
  // Start timing this function
  console.time('generateEmbeddings_total');
  console.log('=== Starting embedding generation ===');
  
  // Add retry mechanism
  const maxRetries = 3;
  let retryCount = 0;
  let lastError = null;
  
  while (retryCount < maxRetries) {
    try {
      // Enhanced API key validation - check early and provide detailed error message
      if (!OPENAI_API_KEY) {
        console.error('❌ CRITICAL ERROR: OPENAI_API_KEY environment variable is missing or empty');
        throw new Error('OpenAI API key is not configured');
      }
      
      // Check API key format (basic validation - should start with "sk-" for OpenAI keys)
      if (!OPENAI_API_KEY.startsWith('sk-')) {
        console.warn('⚠️ WARNING: OPENAI_API_KEY may be invalid - does not start with "sk-"');
        console.log(`OPENAI_API_KEY format: ${OPENAI_API_KEY.substring(0, 4)}... (showing first 4 chars only)`);
      }
      
      console.log('✅ OPENAI_API_KEY environment variable is present');
      
      // Ensure the text isn't too long for the embedding model
      // text-embedding-3-large has an 8191 token limit
      const originalLength = text.length;
      const truncatedText = text.slice(0, 30000); // approximate character limit
      
      console.log(`Generating embeddings for text (original length: ${originalLength}, truncated: ${truncatedText.length})`);
      
      console.log('Using OpenAI text-embedding-3-large model');
      
      // Generate embeddings with OpenAI - time this specific API call
      console.time('openai_embeddings_api_call');
      console.log(`Making OpenAI API call... (Attempt ${retryCount + 1}/${maxRetries})`);
      
      try {
        const response = await openai.embeddings.create({
          model: "text-embedding-3-large",
          input: truncatedText,
          encoding_format: "float",
        });
        
        console.timeEnd('openai_embeddings_api_call');
        console.log('OpenAI API call successful');
        
        // Get the embedding vector
        const embedding = response.data[0].embedding;
        
        console.log(`Embeddings generated successfully. Dimensions: ${embedding.length}`);
        console.timeEnd('generateEmbeddings_total');
        console.log('=== Embedding generation completed successfully ===');
        
        // Return the embedding vector
        return embedding;
        
      } catch (openaiError) {
        console.timeEnd('openai_embeddings_api_call');
        console.error(`OpenAI API call failed (Attempt ${retryCount + 1}/${maxRetries}):`, openaiError);
        
        // Enhanced error logging
        const errorDetails = openaiError instanceof Error ? {
          message: openaiError.message,
          name: openaiError.name,
          stack: openaiError.stack,
        } : 'Unknown error format';
        
        console.error('Error details:', JSON.stringify(errorDetails, null, 2));
        
        // Check for specific OpenAI API error types
        if (openaiError instanceof OpenAI.APIError) {
          console.error('OpenAI API Error Details:', {
            status: openaiError.status,
            headers: openaiError.headers,
            code: openaiError.code,
            type: openaiError.type,
          });
          
          // For rate limit errors, we should retry after a delay
          if (openaiError.status === 429 || (openaiError.code && openaiError.code === 'rate_limit_exceeded')) {
            console.log(`Rate limit hit. Retrying after delay...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Exponential backoff
            throw openaiError; // Re-throw to trigger retry
          }
        }
        
        throw openaiError; // Re-throw to be caught by outer try-catch
      }
      
    } catch (error) {
      lastError = error;
      retryCount++;
      
      if (retryCount < maxRetries) {
        console.log(`Retrying embedding generation. Attempt ${retryCount + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
      } else {
        console.error(`All ${maxRetries} attempts to generate embeddings failed`);
        break;
      }
    }
  }
  
  // All retries failed, log and return fallback
  console.error('Error generating embeddings after all retries:', lastError);
  console.timeEnd('generateEmbeddings_total');
  console.log('=== Embedding generation failed after all retries ===');
  
  // Use a default dimension for OpenAI text-embedding-3-large (3072)
  console.warn('Returning fallback zero vector with 3072 dimensions');
  return new Array(3072).fill(0);
} 