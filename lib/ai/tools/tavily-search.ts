import { tool } from 'ai';
import { z } from 'zod';
import { tavily } from '@tavily/core';

// Initialize Tavily client with API key from environment variables
const tvly = tavily({
  apiKey: process.env.TAVILY_API_KEY || '',
});

export const tavilySearch = tool({
  description: 'Search the web for real-time information using Tavily search engine. Expects an optimized query.',
  parameters: z.object({
    query: z.string().describe('The optimized search query to look up on the web'),
  }),
  execute: async ({ query }) => {
    try {
      console.log('Received search query:', query);
      
      // Use the provided query directly, assuming it's already enhanced
      const searchQuery = query;
      console.log(`[Tavily Tool] Executing search with provided query: "${searchQuery}"`);
      
      // Perform a search with the Tavily API using the provided query
      const response = await tvly.search(searchQuery, {
        search_depth: 'advanced',
        include_domains: [],
        exclude_domains: [],
        max_results: 5,
      });

      // Log the raw results immediately after receiving them
      console.log(`[Tavily Tool] Raw results received from Tavily:`, JSON.stringify(response.results, null, 2));
      
      console.log('Tavily search response received:', response.results.length, 'results');
      
      // Create metadata for logging and debugging purposes
      console.log('[Tavily Tool] Creating metadata for logging/debugging');
      const searchInfo = {
        query: {
          executed: searchQuery
        },
        results: response.results.map(result => ({
          title: result.title || 'Untitled',
          url: result.url || '',
          content: result.content || '',
          score: result.score || 0
        }))
      };
      console.log('[Tavily Tool] Search info metadata created:', JSON.stringify(searchInfo, null, 2));
      
      // Process results to ensure they're in a consistent format
      const processedResults = response.results.map(result => ({
        title: result.title || 'Untitled',
        url: result.url || '',
        content: result.content || '',
        score: result.score || 0
      }));
      
      console.log('[Tavily Tool] Processing complete, returning formatted text response');
      return {
        results: processedResults,
        query: {
          executed: searchQuery // Record the query that was actually executed
        },
        message: 'Search completed successfully',
      };
    } catch (error) {
      console.error('Tavily search error:', error);
      return {
        results: [],
        query: {
          executed: query // Record the query attempted
        },
        message: `Error performing web search: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
}); 