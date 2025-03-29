import { tool } from 'ai';
import { z } from 'zod';
import { tavily } from '@tavily/core';

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
      console.log('Executing Tavily search with query:', query);
      
      // Perform a search with the Tavily API
      const response = await tvly.search(query, {
        search_depth: 'advanced',
        include_domains: [],
        exclude_domains: [],
        max_results: 5,
      });

      console.log('Tavily search response received:', response.results.length, 'results');
      
      return {
        results: response.results,
        message: 'Search completed successfully',
      };
    } catch (error) {
      console.error('Tavily search error:', error);
      return {
        results: [],
        message: `Error performing web search: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
}); 