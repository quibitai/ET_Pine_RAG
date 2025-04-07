'use client';

import type { UIMessage } from 'ai';
import cx from 'classnames';
import { AnimatePresence, motion } from 'framer-motion';
import { memo, useState } from 'react';
import type { Vote } from '@/lib/db/schema';
import { DocumentToolCall, DocumentToolResult } from './document';
import { PencilEditIcon, SparklesIcon } from './icons';
import { Markdown } from './markdown';
import { MessageActions } from './message-actions';
import { PreviewAttachment } from './preview-attachment';
import { Weather } from './weather';
import equal from 'fast-deep-equal';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { MessageEditor } from './message-editor';
import { DocumentPreview } from './document-preview';
import { MessageReasoning } from './message-reasoning';
import { UseChatHelpers } from '@ai-sdk/react';
import { ChevronDownIcon, ChevronUpIcon, DatabaseIcon, SearchIcon } from 'lucide-react';

// Extend UIMessage type to include metadata
export interface ExtendedUIMessage extends UIMessage {
  metadata?: {
    contextSources?: Array<{
      source?: string;
      content?: string;
      relevance?: number;
    }>;
    vectorIds?: string[];
    searchInfo?: {
      original: string;
      enhanced: string;
      results?: Array<{
        title: string;
        url: string;
        content?: string;
      }>;
    };
  };
}

const DebuggingInfo = ({ message }: { message: ExtendedUIMessage }) => {
  const [isOpen, setIsOpen] = useState(false);
  const metadata = message.metadata || {}; // Ensure metadata is an object even if null/undefined
  
  // Always log what metadata we have
  console.log(`[VERCEL DEBUG] Message ${message.id} metadata:`, metadata);
  
  // Check for different types of metadata content
  const hasAnyMetadata = metadata && Object.keys(metadata).length > 0;
  const hasContextSources = metadata.contextSources && 
                           Array.isArray(metadata.contextSources) && 
                           metadata.contextSources.length > 0;
  
  // Create a formatted version of searchInfo if it exists
  let searchInfoSection = null;
  if (metadata.searchInfo) {
    // Handle various possible structures
    if (typeof metadata.searchInfo === 'object') {
      const searchInfo = metadata.searchInfo;
      
      // Create a section for the query information
      const hasQueryInfo = searchInfo.original || searchInfo.enhanced;
      const hasResults = searchInfo.results && 
                        Array.isArray(searchInfo.results) && 
                        searchInfo.results.length > 0;
      
      if (hasQueryInfo || hasResults) {
        searchInfoSection = (
          <>
            {/* Search query section */}
            {hasQueryInfo && (
              <div className="mt-3">
                <div className="font-medium mb-2">Search Query</div>
                <div className="grid grid-cols-2 gap-2 text-xs p-2 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-800">
                  {searchInfo.original && (
                    <>
                      <div className="text-gray-500">Original:</div>
                      <div>{searchInfo.original}</div>
                    </>
                  )}
                  {searchInfo.enhanced && (
                    <>
                      <div className="text-gray-500">Enhanced:</div>
                      <div>{searchInfo.enhanced}</div>
                    </>
                  )}
                </div>
              </div>
            )}
            
            {/* Special section for no results */}
            {!hasResults && hasQueryInfo && (
              <div className="mt-3 p-2 bg-yellow-50 dark:bg-yellow-900 rounded border border-yellow-200 dark:border-yellow-800">
                <div className="font-medium">Search Results: None Found</div>
                <div className="text-xs mt-1">The search query did not return any relevant results.</div>
              </div>
            )}
            
            {/* Results section (if available) */}
            {hasResults && searchInfo.results && (
              <div className="mt-3">
                <div className="font-medium mb-2">Search Results ({searchInfo.results.length})</div>
                <div className="space-y-1 mt-1 max-h-60 overflow-y-auto">
                  {searchInfo.results.map((result, i) => (
                    <div key={i} className="text-xs p-2 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-800 mb-2">
                      <div className="font-medium">{result.title}</div>
                      <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline block mb-1">
                        {result.url}
                      </a>
                      {result.content && (
                        <div className="text-xs mt-1 text-gray-600 dark:text-gray-400">
                          {result.content.substring(0, 100)}...
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        );
      }
    }
  }
  
  return (
    <details className="mt-2 border border-gray-200 dark:border-gray-800 rounded-md overflow-hidden">
      <summary className="w-full flex items-center justify-between p-2 text-sm bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer">
        <span className="font-medium">Debug Info</span>
      </summary>
      <div className="p-3 text-sm bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800">
        {!hasAnyMetadata ? (
          <div className="p-2 bg-yellow-50 dark:bg-yellow-900 rounded">
            <p className="text-yellow-800 dark:text-yellow-200">No metadata available for this message.</p>
          </div>
        ) : (
          <>
            {/* Always show raw metadata for debugging */}
            <div className="mb-3">
              <div className="font-medium mb-2">Raw Metadata</div>
              <pre className="text-xs whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-900 p-2 rounded">
                {JSON.stringify(metadata, null, 2)}
              </pre>
            </div>
            
            {/* Only show RAG sources if data exists */}
            {hasContextSources && (
              <div className="mt-3">
                <div className="font-medium mb-2">RAG Sources ({metadata.contextSources.length})</div>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {metadata.contextSources.map((source, i) => (
                    <div key={i} className="p-2 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-800">
                      <div className="font-medium">{source.source || 'Unknown document'}</div>
                      {source.relevance && <div className="text-xs text-gray-500">Relevance: {source.relevance}</div>}
                      {source.content && <div className="mt-1 text-xs">{source.content.substring(0, 150)}...</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Add search info section if we built it above */}
            {searchInfoSection}
          </>
        )}
      </div>
    </details>
  );
};

const PurePreviewMessage = ({
  chatId,
  message,
  vote,
  isLoading,
  setMessages,
  reload,
  isReadonly,
}: {
  chatId: string;
  message: ExtendedUIMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: UseChatHelpers['setMessages'];
  reload: UseChatHelpers['reload'];
  isReadonly: boolean;
}) => {
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  return (
    <AnimatePresence>
      <motion.div
        data-testid={`message-${message.role}`}
        className="w-full mx-auto max-w-3xl px-4 group/message"
        initial={{ y: 5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        data-role={message.role}
      >
        <div
          className={cn(
            'flex gap-4 w-full group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl',
            {
              'w-full': mode === 'edit',
              'group-data-[role=user]/message:w-fit': mode !== 'edit',
            },
          )}
        >
          {message.role === 'assistant' && (
            <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border bg-background">
              <div className="translate-y-px">
                <SparklesIcon size={14} />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-4 w-full">
            {message.experimental_attachments && (
              <div
                data-testid={`message-attachments`}
                className="flex flex-row justify-end gap-2"
              >
                {message.experimental_attachments.map((attachment) => (
                  <PreviewAttachment
                    key={attachment.url}
                    attachment={attachment}
                  />
                ))}
              </div>
            )}

            {message.parts?.map((part, index) => {
              const { type } = part;
              const key = `message-${message.id}-part-${index}`;

              if (type === 'reasoning') {
                return (
                  <MessageReasoning
                    key={key}
                    isLoading={isLoading}
                    reasoning={part.reasoning}
                  />
                );
              }

              if (type === 'text') {
                if (mode === 'view') {
                  return (
                    <div key={key} className="flex flex-row gap-2 items-start">
                      {message.role === 'user' && !isReadonly && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              data-testid="message-edit-button"
                              variant="ghost"
                              className="px-2 h-fit rounded-full text-muted-foreground opacity-0 group-hover/message:opacity-100"
                              onClick={() => {
                                setMode('edit');
                              }}
                            >
                              <PencilEditIcon />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit message</TooltipContent>
                        </Tooltip>
                      )}

                      <div
                        data-testid="message-content"
                        className={cn('flex flex-col gap-4', {
                          'bg-primary text-primary-foreground px-3 py-2 rounded-xl':
                            message.role === 'user',
                        })}
                      >
                        <Markdown>{part.text}</Markdown>
                      </div>
                    </div>
                  );
                }

                if (mode === 'edit') {
                  return (
                    <div key={key} className="flex flex-row gap-2 items-start">
                      <div className="size-8" />

                      <MessageEditor
                        key={message.id}
                        message={message}
                        setMode={setMode}
                        setMessages={setMessages}
                        reload={reload}
                      />
                    </div>
                  );
                }
              }

              if (type === 'tool-invocation') {
                const { toolInvocation } = part;
                const { toolName, toolCallId, state } = toolInvocation;

                if (state === 'call') {
                  const { args } = toolInvocation;

                  return (
                    <div
                      key={toolCallId}
                      className={cx({
                        skeleton: ['getWeather'].includes(toolName),
                      })}
                    >
                      {toolName === 'getWeather' ? (
                        <Weather />
                      ) : toolName === 'createDocument' ? (
                        <DocumentPreview isReadonly={isReadonly} args={args} />
                      ) : toolName === 'updateDocument' ? (
                        <DocumentToolCall
                          type="update"
                          args={args}
                          isReadonly={isReadonly}
                        />
                      ) : toolName === 'requestSuggestions' ? (
                        <DocumentToolCall
                          type="request-suggestions"
                          args={args}
                          isReadonly={isReadonly}
                        />
                      ) : null}
                    </div>
                  );
                }

                if (state === 'result') {
                  const { result } = toolInvocation;

                  return (
                    <div key={toolCallId}>
                      {toolName === 'getWeather' ? (
                        <Weather weatherAtLocation={result} />
                      ) : toolName === 'createDocument' ? (
                        <DocumentPreview
                          isReadonly={isReadonly}
                          result={result}
                        />
                      ) : toolName === 'updateDocument' ? (
                        <DocumentToolResult
                          type="update"
                          result={result}
                          isReadonly={isReadonly}
                        />
                      ) : toolName === 'requestSuggestions' ? (
                        <DocumentToolResult
                          type="request-suggestions"
                          result={result}
                          isReadonly={isReadonly}
                        />
                      ) : (
                        <pre>{JSON.stringify(result, null, 2)}</pre>
                      )}
                    </div>
                  );
                }
              }
            })}

            {!isReadonly && (
              <MessageActions
                key={`action-${message.id}`}
                chatId={chatId}
                message={message}
                vote={vote}
                isLoading={isLoading}
              />
            )}
            
            {/* ALWAYS RENDER DEBUG INFO FOR ASSISTANT MESSAGES */}
            {message.role === 'assistant' && (
              <DebuggingInfo message={message} />
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    if (prevProps.message.id !== nextProps.message.id) return false;
    if (!equal(prevProps.message.parts, nextProps.message.parts)) return false;
    if (!equal(prevProps.vote, nextProps.vote)) return false;

    return true;
  },
);

export const ThinkingMessage = () => {
  const role = 'assistant';

  return (
    <motion.div
      data-testid="message-assistant-loading"
      className="w-full mx-auto max-w-3xl px-4 group/message "
      initial={{ y: 5, opacity: 0 }}
      animate={{ y: 0, opacity: 1, transition: { delay: 1 } }}
      data-role={role}
    >
      <div
        className={cx(
          'flex gap-4 group-data-[role=user]/message:px-3 w-full group-data-[role=user]/message:w-fit group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl group-data-[role=user]/message:py-2 rounded-xl',
          {
            'group-data-[role=user]/message:bg-muted': true,
          },
        )}
      >
        <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border">
          <SparklesIcon size={14} />
        </div>

        <div className="flex flex-col gap-2 w-full">
          <div className="flex flex-col gap-4 text-muted-foreground">
            Hmm...
          </div>
        </div>
      </div>
    </motion.div>
  );
};
