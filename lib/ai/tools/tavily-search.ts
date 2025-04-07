import { tool } from 'ai';
import { z } from 'zod';
import { tavily } from '@tavily/core';

// Initialize Tavily client with API key from environment variables
const tvly = tavily({
  apiKey: process.env.TAVILY_API_KEY || '',
});

// Minimum relevance score threshold for filtering out low-quality results
const MIN_RELEVANCE_SCORE = 0.5;

export const tavilySearch = tool({
  description: 'Search the web for real-time information using Tavily search engine. Use this tool to find current information, news, and data not available in the AI\'s training data. Perfect for fact-checking, finding recent events, and answering queries about current information.',
  parameters: z.object({
    query: z.string().describe('The search query to look up. Make this specific, clear, and concise (under 300 characters).'),
    include_domains: z.array(z.string()).optional().describe('Optional: List of domains to specifically include in the search (e.g., ["example.com", "anothersite.org"]).'),
    exclude_domains: z.array(z.string()).optional().describe('Optional: List of domains to exclude from the search.'),
    search_depth: z.enum(['basic', 'advanced']).optional().describe('Optional: Depth of search. Default is "advanced".'),
    max_results: z.number().optional().describe('Optional: Max results to return (1-10). Default is 5.'),
    include_answer: z.boolean().optional().describe('Optional: Include an AI-generated answer summary. Default is false.'),
    include_raw_content: z.boolean().optional().describe('Optional: Include the raw HTML content. Default is false.'),
    time_range: z.enum(['day', 'week', 'month', 'year']).optional().describe('Optional: Time range for results.'),
    topic: z.enum(['general', 'news', 'finance']).optional().describe('Optional: Specific topic focus. Default is "general".'),
  }),
  execute: async ({ 
    query, 
    include_domains, 
    exclude_domains, 
    search_depth, 
    max_results,
    include_answer,
    include_raw_content,
    time_range,
    topic
  }) => {
    try {
      // Define final parameters with defaults for optional parameters
      const final_include_domains = include_domains ?? [];
      const final_exclude_domains = exclude_domains ?? [];
      const final_search_depth = search_depth ?? 'advanced';
      const final_max_results = max_results ?? 5;
      const final_include_answer = include_answer ?? false;
      const final_include_raw_content = include_raw_content ?? false;
      const final_topic = topic ?? 'general';
      // time_range doesn't need a default

      console.log(`[Tavily Tool] Executing search with query: "${query}"`);
      console.log(`[Tavily Tool] Search parameters: depth=${final_search_depth}, max_results=${final_max_results}, time_range=${time_range || 'default'}, topic=${final_topic || 'none'}`);
      console.log(`[Tavily Tool] Domain filters: include=${final_include_domains.length > 0 ? final_include_domains.join(',') : 'none'}, exclude=${final_exclude_domains.length > 0 ? final_exclude_domains.join(',') : 'none'}`);
      
      // Ensure max_results is within valid range (1-10) even without schema validation
      const validatedMaxResults = Math.max(1, Math.min(10, final_max_results));
      if (validatedMaxResults !== final_max_results) {
        console.log(`[Tavily Tool] Adjusted max_results from ${final_max_results} to ${validatedMaxResults}`);
      }
      
      // Prepare options for Tavily API call
      const tavilyOptions: any = {
        search_depth: final_search_depth,
        max_results: validatedMaxResults, // Use validated value
        include_answer: final_include_answer,
        include_raw_content: final_include_raw_content,
        ...(time_range && { time_range }),
        ...(final_topic && { topic: final_topic })
      };

      // Only include domain filters if they have values
      if (final_include_domains.length > 0) {
        tavilyOptions.include_domains = final_include_domains;
      }
      
      if (final_exclude_domains.length > 0) {
        tavilyOptions.exclude_domains = final_exclude_domains;
      }
      
      // Perform a search with the Tavily API using provided parameters
      const response = await tvly.search(query, tavilyOptions);

      // Log the raw results immediately after receiving them
      console.log(`[Tavily Tool] Raw results received from Tavily: ${response.results.length} results`);
      
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
      
      console.log(`[Tavily Tool] After filtering (min score ${MIN_RELEVANCE_SCORE}): ${filteredResults.length} results remain`);
      
      // Create search metadata for internal use
      const searchInfo = {
        query: {
          original: query,
          executed: query
        },
        parameters: {
          search_depth: final_search_depth,
          max_results: validatedMaxResults,
          include_domains: final_include_domains.length > 0 ? final_include_domains : undefined,
          exclude_domains: final_exclude_domains.length > 0 ? final_exclude_domains : undefined,
          time_range: time_range || undefined,
          topic: final_topic || undefined
        },
        results: filteredResults
      };
      
      // Include the AI-generated answer if it was requested and provided
      const answer = final_include_answer && response.answer ? response.answer : undefined;
      
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
      console.error('[Tavily Tool] Search error:', error);
      
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
          console.error('[Tavily Tool] API key issue detected');
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