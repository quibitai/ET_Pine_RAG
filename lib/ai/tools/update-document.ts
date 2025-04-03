import { DataStreamWriter, tool } from 'ai';
import { Session } from 'next-auth';
import { z } from 'zod';
import { getDocumentById, saveDocument } from '@/lib/db/queries';
import { documentHandlersByArtifactKind } from '@/lib/artifacts/server';

interface UpdateDocumentProps {
  session: Session;
  dataStream: DataStreamWriter;
}

export const updateDocument = ({ session, dataStream }: UpdateDocumentProps) =>
  tool({
    description: 'Update a document with the given description.',
    parameters: z.object({
      id: z.string().describe('The ID of the document to update'),
      description: z
        .string()
        .describe('The description of changes that need to be made'),
    }),
    execute: async ({ id, description }) => {
      const document = await getDocumentById({ id });

      if (!document) {
        return {
          error: 'Document not found',
        };
      }

      dataStream.writeData({
        type: 'clear',
        content: document.fileName,
      });

      // Determine document kind based on fileType
      const documentKind = document.fileType.includes('image') 
        ? 'image' 
        : document.fileType.includes('sheet') || document.fileType.includes('csv') 
          ? 'sheet' 
          : document.fileType.includes('code') || document.fileName.endsWith('.js') || document.fileName.endsWith('.ts')
            ? 'code'
            : 'text';

      const documentHandler = documentHandlersByArtifactKind.find(
        (documentHandlerByArtifactKind) =>
          documentHandlerByArtifactKind.kind === documentKind,
      );

      if (!documentHandler) {
        throw new Error(`No document handler found for kind: ${documentKind}`);
      }

      await documentHandler.onUpdateDocument({
        document,
        description,
        dataStream,
        session,
      });

      dataStream.writeData({ type: 'finish', content: '' });

      return {
        id,
        title: document.fileName,
        kind: documentKind,
        content: 'The document has been updated successfully.',
      };
    },
  });
