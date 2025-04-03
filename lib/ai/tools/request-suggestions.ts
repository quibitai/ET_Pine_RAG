import { z } from 'zod';
import { Session } from 'next-auth';
import { DataStreamWriter, streamObject, tool } from 'ai';
import { getDocumentById, saveSuggestions } from '@/lib/db/queries';
import { Suggestion } from '@/lib/db/schema';
import { generateUUID } from '@/lib/utils';
import { myProvider } from '../providers';

interface RequestSuggestionsProps {
  session: Session;
  dataStream: DataStreamWriter;
}

export const requestSuggestions = ({
  session,
  dataStream,
}: RequestSuggestionsProps) =>
  tool({
    description: 'Request suggestions for a document',
    parameters: z.object({
      documentId: z
        .string()
        .describe('The ID of the document to request edits'),
    }),
    execute: async ({ documentId }) => {
      const document = await getDocumentById({ id: documentId });

      if (!document || !document.blobUrl) {
        return {
          error: 'Document metadata or Blob URL not found',
        };
      }

      // Fetch content from blobUrl
      let fetchedContent: string | null = null;
      try {
        const response = await fetch(document.blobUrl);
        if (!response.ok) {
          console.error(`Failed to fetch content for ${documentId}: ${response.statusText}`);
          return { error: `Failed to fetch document content: ${response.statusText}` };
        }
        fetchedContent = await response.text();
      } catch (fetchError) {
        console.error(`Error fetching content for ${documentId}:`, fetchError);
        return { error: 'Failed to fetch document content' };
      }

      // Check if content is valid
      if (!fetchedContent) {
        return {
          error: 'Document content is empty or could not be fetched',
        };
      }

      const suggestions: Array<
        Omit<Suggestion, 'userId' | 'createdAt' | 'documentCreatedAt'>
      > = [];

      const { elementStream } = streamObject({
        model: myProvider.languageModel('artifact-model'),
        system:
          'You are a help writing assistant. Given a piece of writing, please offer suggestions to improve the piece of writing and describe the change. It is very important for the edits to contain full sentences instead of just words. Max 5 suggestions.',
        prompt: fetchedContent,
        output: 'array',
        schema: z.object({
          originalSentence: z.string().describe('The original sentence'),
          suggestedSentence: z.string().describe('The suggested sentence'),
          description: z.string().describe('The description of the suggestion'),
        }),
      });

      for await (const element of elementStream) {
        const suggestion = {
          originalText: element.originalSentence,
          suggestedText: element.suggestedSentence,
          description: element.description,
          id: generateUUID(),
          documentId: documentId,
          isResolved: false,
        };

        dataStream.writeData({
          type: 'suggestion',
          content: suggestion,
        });

        suggestions.push(suggestion);
      }

      if (session.user?.id) {
        const userId = session.user.id;

        await saveSuggestions({
          suggestions: suggestions.map((suggestion) => ({
            ...suggestion,
            userId,
            createdAt: new Date(),
            documentCreatedAt: document.createdAt,
          })),
        });
      }

      return {
        id: documentId,
        title: document.fileName,
        message: 'Suggestions have been added to the document',
      };
    },
  });
