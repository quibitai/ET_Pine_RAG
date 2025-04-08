import { tool } from 'ai';
import { z } from 'zod';
import { tavily } from '@tavily/core';

// Initialize Tavily client with API key from environment variables
const tvly = tavily({
  apiKey: process.env.TAVILY_API_KEY || '',
});

// Minimum relevance score threshold for filtering out low-quality results
const MIN_RELEVANCE_SCORE = 0.35;

export const tavilySearch = tool({
  description: 'Search the web for real-time information using Tavily search engine. Use this tool to find current information, news, and data not available in the AI\'s training data. Perfect for fact-checking, finding recent events, and answering queries about current information.',
  parameters: z.object({
    query: z.string().describe('The search query to look up. Make this specific, clear, and concise (under 300 characters).'),
    include_domains: z.array(z.string()).describe('List of domains to specifically include in the search (provide empty array [] if no specific domains needed)'),
    exclude_domains: z.array(z.string()).describe('List of domains to specifically exclude from the search (provide empty array [] if no domains to exclude)'),
    search_depth: z.enum(['basic', 'advanced']).describe('The depth of search to perform. Use "advanced" for more comprehensive results.'),
    max_results: z.number().describe('Maximum number of results to return (1-10). Recommended: 5.'),
    include_answer: z.boolean().describe('Whether to include an AI-generated answer summary.'),
    include_raw_content: z.boolean().describe('Whether to include the raw HTML content.'),
    time_range: z.enum(['day', 'week', 'month', 'year']).describe('Time range for search results.'),
    topic: z.enum(['general', 'news', 'finance']).describe('Specific topic to focus the search on. Default is "general".'),
  }),
  execute: async ({ 
    query, 
    include_domains = [], 
    exclude_domains = [], 
    search_depth = 'advanced', 
    max_results = 5,
    include_answer = false,
    include_raw_content = false,
    time_range,
    topic = 'general'
  }) => {
    try {
      // Create a unique ID for this search request for easier log tracking
      const searchId = `ts_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      
      // Log detailed information about the search request
      console.log(`[Tavily Tool ${searchId}] Executing search with query: "${query}"`);
      console.log(`[Tavily Tool ${searchId}] Parameters:`, {
        query,
        include_domains,
        exclude_domains,
        search_depth,
        max_results,
        include_answer,
        include_raw_content,
        time_range,
        topic
      });
      
      // Check for common o3-mini model compatibility issues
      if (!include_domains || !Array.isArray(include_domains)) {
        console.warn(`[Tavily Tool ${searchId}] WARNING: include_domains is ${include_domains === undefined ? 'undefined' : typeof include_domains}. Required for o3-mini model.`);
        // Default to empty array to prevent errors
        include_domains = [];
      }
      
      // Ensure exclude_domains is always an array
      if (!exclude_domains || !Array.isArray(exclude_domains)) {
        console.warn(`[Tavily Tool ${searchId}] WARNING: exclude_domains is ${exclude_domains === undefined ? 'undefined' : typeof exclude_domains}. Setting to empty array.`);
        exclude_domains = [];
      }
      
      // Ensure max_results is within valid range (1-10) even without schema validation
      const validatedMaxResults = Math.max(1, Math.min(10, max_results));
      if (validatedMaxResults !== max_results) {
        console.log(`[Tavily Tool ${searchId}] Adjusted max_results from ${max_results} to ${validatedMaxResults}`);
      }
      
      // Perform a search with the Tavily API using provided parameters
      console.time(`tavily_search_${searchId}`);
      const response = await tvly.search(query, {
        search_depth,
        include_domains,
        exclude_domains,
        max_results: validatedMaxResults, // Use validated value
        include_answer,
        include_raw_content,
        ...(time_range && { time_range }),
        ...(topic && { topic })
      });
      console.timeEnd(`tavily_search_${searchId}`);

      // *** ADD THIS LOGGING BLOCK ***
      console.log(`[Tavily Tool ${searchId}] Raw results received from Tavily (${response.results?.length || 0} results):`);
      if (response.results && response.results.length > 0) {
        response.results.forEach((result, index) => {
          console.log(`  Raw Result ${index + 1}:`);
          console.log(`    - Title: ${result.title || 'Untitled'}`);
          console.log(`    - URL: ${result.url || 'No URL'}`);
          console.log(`    - Score: ${result.score !== undefined ? result.score.toFixed(4) : 'N/A'}`); // Log the score
          console.log(`    - Content Preview: ${(result.content || '').substring(0, 100)}...`);
          // Ensure 'publishedDate' matches the actual field name from Tavily's response object
          console.log(`    - Published Date: ${result.publishedDate || 'N/A'}`);
        });
      } else {
        console.log(`  (No results returned by Tavily API)`);
      }
      // *** END LOGGING BLOCK ***

      // Log the raw results immediately after receiving them
      console.log(`[Tavily Tool ${searchId}] Raw results received from Tavily: ${response.results.length} results`);
      
      // Filter out low-quality results based on relevance score
      const filteredResults = response.results
        .filter(result => (result.score || 0) >= MIN_RELEVANCE_SCORE)
        .map(result => ({
          title: result.title || 'Untitled',
          url: result.url || '',
          content: result.content || '',
          score: result.score || 0,
          published_date: result.publishedDate || null
        }));
      
      console.log(`[Tavily Tool ${searchId}] After filtering (min score ${MIN_RELEVANCE_SCORE}): ${filteredResults.length} results remain`);
      
      // Create search metadata for internal use
      const searchInfo = {
        query: {
          original: query,
          executed: query
        },
        parameters: {
          search_depth,
          max_results: validatedMaxResults,
          include_domains: include_domains.length > 0 ? include_domains : undefined,
          exclude_domains: exclude_domains.length > 0 ? exclude_domains : undefined,
          time_range: time_range || undefined,
          topic: topic || undefined
        },
        results: filteredResults
      };
      
      // Include the AI-generated answer if it was requested and provided
      const answer = include_answer && response.answer ? response.answer : undefined;
      
      return {
        results: filteredResults,
        query: {
          executed: query 
        },
        answer,
        message: filteredResults.length > 0 
          ? `Found ${filteredResults.length} relevant results for your query.` 
          : 'No relevant results found for your query.',
      };
    } catch (error) {
      // Create a unique error ID
      const errorId = `ts_err_${Date.now().toString(36)}`;
      console.error(`[Tavily Tool ${errorId}] Search error:`, error);
      
      // Capture detailed error properties for better debugging
      if (error instanceof Error) {
        const errorObj = {
          name: error.name,
          message: error.message,
          stack: error.stack ? error.stack.split('\n').slice(0, 3).join('\n') + '...' : undefined,
          cause: error.cause
        };
        console.error(`[Tavily Tool ${errorId}] Error details:`, errorObj);
      }
      
      // Categorize error types for better debugging
      let errorMessage = 'Error performing web search: ';
      
      if (error instanceof Error) {
        // Extract specific error types for better error handling
        if (error.message.includes('rate limit')) {
          errorMessage += 'Rate limit exceeded. Please try again in a moment.';
        } else if (error.message.includes('timeout')) {
          errorMessage += 'Search timed out. Please try a more specific query.';
        } else if (error.message.includes('api key')) {
          errorMessage += 'API authentication error.';
          console.error(`[Tavily Tool ${errorId}] API key issue detected`);
        } else {
          errorMessage += error.message;
        }
      } else {
        errorMessage += String(error);
      }
      
      return {
        results: [],
        query: {
          executed: query
        },
        message: errorMessage,
      };
    }
  },
}); 