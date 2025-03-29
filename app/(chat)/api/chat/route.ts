import {
  UIMessage,
  appendResponseMessages,
  createDataStreamResponse,
  smoothStream,
  streamText,
} from 'ai';
import { auth } from '@/app/(auth)/auth';
import { systemPrompt } from '@/lib/ai/prompts';
import {
  deleteChatById,
  getChatById,
  saveChat,
  saveMessages,
} from '@/lib/db/queries';
import {
  generateUUID,
  getMostRecentUserMessage,
  getTrailingMessageId,
} from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { createDocument } from '@/lib/ai/tools/create-document';
import { updateDocument } from '@/lib/ai/tools/update-document';
import { requestSuggestions } from '@/lib/ai/tools/request-suggestions';
import { getWeather } from '@/lib/ai/tools/get-weather';
import { tavilySearch } from '@/lib/ai/tools/tavily-search';
import { isProductionEnvironment } from '@/lib/constants';
import { myProvider } from '@/lib/ai/providers';
import { generateEmbeddings } from '@/lib/ai/utils';
import { getPineconeIndex } from '@/lib/pinecone-client';

export const maxDuration = 60;
export const runtime = 'edge';

export async function POST(request: Request) {
  try {
    console.log("API route POST handler invoked");
    const {
      id,
      messages,
      selectedChatModel,
    }: {
      id: string;
      messages: Array<UIMessage>;
      selectedChatModel: string;
    } = await request.json();

    console.log("Request parsed: ", { id, messageCount: messages.length, selectedChatModel });

    const session = await auth();

    if (!session || !session.user || !session.user.id) {
      console.log("Authentication failed: User not authenticated");
      return new Response('Unauthorized', { status: 401 });
    }

    console.log("Authentication successful: User ID", session.user.id);

    const userMessage = getMostRecentUserMessage(messages);

    if (!userMessage) {
      console.log("No user message found in the request");
      return new Response('No user message found', { status: 400 });
    }

    console.log("User message found", userMessage.id);

    const chat = await getChatById({ id });

    if (!chat) {
      console.log("Chat not found, creating new chat");
      const title = await generateTitleFromUserMessage({
        message: userMessage,
      });

      await saveChat({ id, userId: session.user.id, title });
    } else {
      if (chat.userId !== session.user.id) {
        console.log("User not authorized to access this chat");
        return new Response('Unauthorized', { status: 401 });
      }
    }

    console.log("Saving user message to database");
    await saveMessages({
      messages: [
        {
          chatId: id,
          id: userMessage.id,
          role: 'user',
          parts: userMessage.parts,
          attachments: userMessage.experimental_attachments ?? [],
          createdAt: new Date(),
        },
      ],
    });

    let contextText = '';
    if (userMessage.parts[0] && 'text' in userMessage.parts[0] && userMessage.parts[0].text) {
      try {
        const userQuery = userMessage.parts[0].text;
        console.log("Retrieving relevant document context for:", userQuery.substring(0, 100) + '...');
        
        const embedding = await generateEmbeddings(userQuery);
        
        const index = getPineconeIndex();
        const queryResults = await index.query({
          vector: embedding,
          topK: 5,
          filter: { userId: session.user.id },
          includeMetadata: true,
        });
        
        if (queryResults.matches && Array.isArray(queryResults.matches) && queryResults.matches.length > 0) {
          contextText = queryResults.matches
            .map(match => {
              const text = match.metadata?.text || '';
              const source = match.metadata?.source || 'Unknown document';
              const score = match.score ? Math.round(match.score * 100) / 100 : 0;
              return `[SOURCE: ${source}] (relevance: ${score})\n${text}`;
            })
            .filter(text => text.length > 0)
            .join('\n\n');
          
          console.log('Found relevant context:', contextText.substring(0, 100) + '...');
          console.log(`Retrieved ${queryResults.matches.length} relevant chunks from documents`);
        } else {
          console.log('No relevant context found in user documents');
        }
      } catch (error) {
        console.error('Error retrieving RAG context:', error);
      }
    }

    let enhancedSystemPrompt = systemPrompt({ selectedChatModel });
    if (contextText) {
      enhancedSystemPrompt = `${enhancedSystemPrompt}

RELEVANT DOCUMENT CONTEXT:
${contextText}

Use the above context information to answer the user's question if relevant. When using information from the context, mention the source document (e.g., "According to [SOURCE NAME]"). If the context doesn't contain information relevant to the user's query, rely on your general knowledge or web search.`;
    }

    console.log("Creating data stream response with model:", selectedChatModel);
    return createDataStreamResponse({
      execute: (dataStream) => {
        console.log("Streaming text from AI model");
        const result = streamText({
          model: myProvider.languageModel(selectedChatModel),
          system: enhancedSystemPrompt,
          messages,
          maxSteps: 5,
          experimental_activeTools: [
            'getWeather',
            'createDocument',
            'updateDocument',
            'requestSuggestions',
            'tavilySearch',
          ],
          experimental_transform: smoothStream({ chunking: 'word' }),
          experimental_generateMessageId: generateUUID,
          tools: {
            getWeather,
            createDocument: createDocument({ session, dataStream }),
            updateDocument: updateDocument({ session, dataStream }),
            requestSuggestions: requestSuggestions({
              session,
              dataStream,
            }),
            tavilySearch,
          },
          onFinish: async ({ response }) => {
            if (session.user?.id) {
              try {
                const assistantId = getTrailingMessageId({
                  messages: response.messages.filter(
                    (message) => message.role === 'assistant',
                  ),
                });

                if (!assistantId) {
                  throw new Error('No assistant message found!');
                }

                const [, assistantMessage] = appendResponseMessages({
                  messages: [userMessage],
                  responseMessages: response.messages,
                });

                await saveMessages({
                  messages: [
                    {
                      id: assistantId,
                      chatId: id,
                      role: assistantMessage.role,
                      parts: assistantMessage.parts,
                      attachments:
                        assistantMessage.experimental_attachments ?? [],
                      createdAt: new Date(),
                    },
                  ],
                });
              } catch (error) {
                console.error('Failed to save chat', error);
              }
            }
          },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: 'stream-text',
          },
        });

        result.consumeStream();

        result.mergeIntoDataStream(dataStream, {
          sendReasoning: true,
        });
      },
      onError: (error) => {
        console.error('Error in data stream:', error);
        return 'Oops, an error occurred while processing your request. Please try again.';
      },
    });
  } catch (error) {
    console.error('Unhandled error in API route:', error);
    return new Response(
      `An error occurred while processing your request: ${error instanceof Error ? error.message : String(error)}`,
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new Response('Not Found', { status: 404 });
  }

  const session = await auth();

  if (!session || !session.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const chat = await getChatById({ id });

    if (chat.userId !== session.user.id) {
      return new Response('Unauthorized', { status: 401 });
    }

    await deleteChatById({ id });

    return new Response('Chat deleted', { status: 200 });
  } catch (error) {
    return new Response('An error occurred while processing your request!', {
      status: 500,
    });
  }
}
