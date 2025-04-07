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
interface ExtendedUIMessage extends UIMessage {
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

  // Extract debugging information from message
  let hasDebuggingInfo = false;
  let documentContext = null;
  let vectorIds: string[] = [];
  let searchInfo = null;

  // Check for RAG information in metadata
  if (message.metadata?.contextSources && message.metadata.contextSources.length > 0) {
    hasDebuggingInfo = true;
    documentContext = message.metadata.contextSources;
    vectorIds = message.metadata.vectorIds || [];
  }

  // Check for search information
  if (message.metadata?.searchInfo) {
    hasDebuggingInfo = true;
    searchInfo = message.metadata.searchInfo;
  }

  if (!hasDebuggingInfo) return null;

  return (
    <div className="mt-3 border border-border rounded-md">
      <button 
        className="w-full flex items-center justify-between p-2 text-xs text-muted-foreground hover:bg-muted/30 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium">Debug Info</span>
          {documentContext && (
            <span className="flex items-center gap-1 text-xs">
              <DatabaseIcon size={12} /> {vectorIds?.length || documentContext.length} sources
            </span>
          )}
          {searchInfo && (
            <span className="flex items-center gap-1 text-xs">
              <SearchIcon size={12} /> search query
            </span>
          )}
        </div>
        {isOpen ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
      </button>
      
      {isOpen && (
        <div className="p-3 text-xs border-t border-border bg-muted/30">
          {documentContext && (
            <div className="mb-3">
              <div className="font-medium mb-1 flex items-center gap-1">
                <DatabaseIcon size={12} /> Document Sources
              </div>
              <div className="max-h-40 overflow-y-auto">
                {documentContext.map((source, i: number) => (
                  <div key={i} className="mb-2 p-2 bg-muted/50 rounded border border-border">
                    <div className="font-medium">{source.source || 'Unknown document'}</div>
                    {vectorIds && vectorIds[i] && <div className="text-xs text-muted-foreground">ID: {vectorIds[i]}</div>}
                    {source.relevance && <div className="text-xs text-muted-foreground">Relevance: {source.relevance}</div>}
                    {source.content && <div className="mt-1 whitespace-pre-wrap">{source.content}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {searchInfo && (
            <div>
              <div className="font-medium mb-1 flex items-center gap-1">
                <SearchIcon size={12} /> Search Query
              </div>
              <div className="p-2 bg-muted/50 rounded border border-border">
                <div className="grid grid-cols-2 gap-1">
                  <div className="text-muted-foreground">Original:</div>
                  <div>{searchInfo.original}</div>
                  <div className="text-muted-foreground">Enhanced:</div>
                  <div>{searchInfo.enhanced}</div>
                </div>
                {searchInfo.results && (
                  <>
                    <div className="font-medium mt-2 mb-1">Results</div>
                    <div className="max-h-40 overflow-y-auto">
                      {searchInfo.results.map((result, i: number) => (
                        <div key={i} className="mb-1 pb-1 border-b border-border last:border-0">
                          <div className="font-medium">{result.title}</div>
                          <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500">{result.url}</a>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
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
