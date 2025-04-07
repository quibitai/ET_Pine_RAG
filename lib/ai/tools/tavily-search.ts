import { tool } from 'ai';
import { z } from 'zod';
import { tavily } from '@tavily/core';
import { enhanceSearchQuery } from '@/lib/ai/utils';

// Initialize Tavily client with API key from environment variables
const tvly = tavily({
  apiKey: process.env.TAVILY_API_KEY || '',
});

export const tavilySearch = tool({
  description: 'Search the web for real-time information using Tavily search engine',
  parameters: z.object({
    query: z.string().describe('The search query to look up on the web'),
  }),
  execute: async ({ query }) => {
    try {
      console.log('Received original search query:', query);
      
      // Enhance the query using the LLM-powered function
      const enhancedQuery = await enhanceSearchQuery(query);
      console.log('Enhanced search query:', enhancedQuery);
      
      // Log the exact query being sent to Tavily
      console.log(`[Tavily Tool] Executing search with enhanced query: "${enhancedQuery}"`);
      
      // Perform a search with the Tavily API using the enhanced query
      const response = await tvly.search(enhancedQuery, {
        search_depth: 'advanced',
        include_domains: [],
        exclude_domains: [],
        max_results: 5,
      });

      // Log the raw results immediately after receiving them
      console.log(`[Tavily Tool] Raw results received from Tavily:`, JSON.stringify(response.results, null, 2));
      
      console.log('Tavily search response received:', response.results.length, 'results');
      
      // Process results to ensure they're in a consistent format
      const processedResults = response.results.map(result => ({
        title: result.title || 'Untitled',
        url: result.url || '',
        content: result.content || '',
        score: result.score || 0
      }));
      
      return {
        results: processedResults,
        query: {
          original: query,
          enhanced: enhancedQuery
        },
        message: 'Search completed successfully',
      };
    } catch (error) {
      console.error('Tavily search error:', error);
      return {
        results: [],
        query: {
          original: query,
          enhanced: null
        },
        message: `Error performing web search: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
}); 