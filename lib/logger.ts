import chalk from 'chalk';

/**
 * Log levels for the application
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Current log level from environment or default to INFO
 */
const currentLogLevel = 
  process.env.LOG_LEVEL 
    ? (LogLevel[process.env.LOG_LEVEL as keyof typeof LogLevel] ?? LogLevel.INFO) 
    : LogLevel.INFO;

/**
 * Format a date for logging
 */
const formatDate = () => {
  return new Date().toISOString();
};

/**
 * Main logger utility for structured logging
 */
export const logger = {
  /**
   * Debug level logging
   */
  debug: (message: string, meta?: any) => {
    if (currentLogLevel <= LogLevel.DEBUG) {
      console.log(
        chalk.gray(`[${formatDate()}] 🔍 DEBUG: ${message}`)
      );
      if (meta) console.log(chalk.gray(JSON.stringify(meta, null, 2)));
    }
  },

  /**
   * Info level logging
   */
  info: (message: string, meta?: any) => {
    if (currentLogLevel <= LogLevel.INFO) {
      console.log(
        chalk.blue(`[${formatDate()}] ℹ️ INFO: ${message}`)
      );
      if (meta) console.log(JSON.stringify(meta, null, 2));
    }
  },

  /**
   * Warning level logging
   */
  warn: (message: string, meta?: any) => {
    if (currentLogLevel <= LogLevel.WARN) {
      console.log(
        chalk.yellow(`[${formatDate()}] ⚠️ WARN: ${message}`)
      );
      if (meta) console.log(chalk.yellow(JSON.stringify(meta, null, 2)));
    }
  },

  /**
   * Error level logging
   */
  error: (message: string, error?: any) => {
    if (currentLogLevel <= LogLevel.ERROR) {
      console.log(
        chalk.red(`[${formatDate()}] 🔴 ERROR: ${message}`)
      );
      if (error) {
        if (error instanceof Error) {
          console.log(chalk.red(`Message: ${error.message}`));
          console.log(chalk.red(`Stack: ${error.stack}`));
        } else {
          console.log(chalk.red(JSON.stringify(error, null, 2)));
        }
      }
    }
  },

  /**
   * Special method for logging RAG context information
   */
  ragContext: (userId: string, queryText: string, results: any) => {
    if (currentLogLevel <= LogLevel.INFO) {
      console.log(
        chalk.green(`[${formatDate()}] 📚 RAG CONTEXT: User ${userId.substring(0, 8)}... queried: "${queryText.substring(0, 100)}${queryText.length > 100 ? '...' : ''}"`)
      );
      
      if (results?.matches?.length > 0) {
        console.log(chalk.green(`Found ${results.matches.length} matching chunks:`));
        results.matches.forEach((match: any, index: number) => {
          console.log(chalk.green(`  ${index + 1}. ID: ${match.id?.substring(0, 12) || 'unknown'} | Score: ${match.score?.toFixed(4) || 'unknown'} | Source: ${match.metadata?.source || 'unknown'}`));
          if (match.metadata?.text) {
            const preview = match.metadata.text.substring(0, 100);
            console.log(chalk.green(`     Preview: "${preview}${match.metadata.text.length > 100 ? '...' : ''}"`));
          }
        });
      } else {
        console.log(chalk.green(`No matching chunks found`));
      }
    }
  },

  /**
   * Special method for logging search information
   */
  searchInfo: (originalQuery: string, enhancedQuery: string, results: any[]) => {
    if (currentLogLevel <= LogLevel.INFO) {
      console.log(
        chalk.magenta(`[${formatDate()}] 🔍 SEARCH: Original query: "${originalQuery}"`)
      );
      console.log(
        chalk.magenta(`Enhanced query: "${enhancedQuery}"`)
      );
      
      if (results?.length > 0) {
        console.log(chalk.magenta(`Found ${results.length} search results:`));
        results.forEach((result: any, index: number) => {
          console.log(chalk.magenta(`  ${index + 1}. Title: ${result.title || 'Untitled'} | URL: ${result.url || 'No URL'}`));
          if (result.content) {
            const preview = result.content.substring(0, 100);
            console.log(chalk.magenta(`     Preview: "${preview}${result.content.length > 100 ? '...' : ''}"`));
          }
        });
      } else {
        console.log(chalk.magenta(`No search results found`));
      }
    }
  },

  /**
   * Special method for logging document processing
   */
  documentProcess: (document: any, status: string, message?: string) => {
    if (currentLogLevel <= LogLevel.INFO) {
      console.log(
        chalk.cyan(`[${formatDate()}] 📄 DOCUMENT: ${status.toUpperCase()} | ID: ${document.id?.substring(0, 8) || 'unknown'} | Name: ${document.fileName || 'unnamed'}`)
      );
      
      if (message) {
        console.log(chalk.cyan(`  Message: ${message}`));
      }
      
      if (document.totalChunks && document.processedChunks !== undefined) {
        const percentage = document.totalChunks > 0 
          ? Math.round((document.processedChunks / document.totalChunks) * 100) 
          : 0;
        console.log(chalk.cyan(`  Progress: ${document.processedChunks}/${document.totalChunks} chunks (${percentage}%)`));
      }
    }
  }
};

export default logger; 