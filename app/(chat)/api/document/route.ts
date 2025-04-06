import { auth } from '@/app/(auth)/auth';
import { ArtifactKind } from '@/components/artifact';
import {
  deleteDocumentsByIdAfterTimestamp,
  getDocumentsById,
  saveDocument,
} from '@/lib/db/queries';
import { Document } from '@/lib/db/schema';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new Response('Missing id', { status: 400 });
  }

  const session = await auth();

  if (!session || !session.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const documents = await getDocumentsById({ id });
  const document = documents[0] as Document | undefined;

  if (!document) {
    return new Response('Not Found', { status: 404 });
  }

  if (document.userId !== session.user.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Add a response header to let the client know it should check for localStorage content
  const headers = new Headers();
  headers.append('X-Document-Check-Storage', 'true');
  
  return Response.json(documents, { 
    status: 200,
    headers
  });
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new Response('Missing id', { status: 400 });
  }

  const session = await auth();

  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const {
    content,
    title,
    kind,
  }: { content: string; title: string; kind: ArtifactKind } =
    await request.json();

  if (session.user?.id) {
    // Calculate file size from content
    const contentBuffer = Buffer.from(content || '');
    const fileSize = contentBuffer.byteLength;

    console.log(`Saving document ${id} with content length ${content?.length || 0} and file size ${fileSize} bytes`);

    // Save the document metadata
    const document = await saveDocument({
      id,
      userId: session.user.id,
      fileName: title,
      fileType: kind === 'code' ? 'text/plain+code' :
                kind === 'image' ? 'image/png' :
                kind === 'sheet' ? 'text/csv' : 'text/plain',
      fileSize: fileSize,
      blobUrl: '',
      processingStatus: 'completed'
    });

    // Store the content in local storage since we don't have a content field in the DB
    try {
      // In a production environment, we would use a proper storage solution
      // like Vercel Blob Storage, S3, or add a content column to the DB
      // For now, we're attaching the content to the response to ensure the client has it
      const documentWithContent = {
        ...document,
        content,
        kind
      };
      
      // Save to localStorage on the client side when the response is received
      return Response.json(documentWithContent, { status: 200 });
    } catch (error) {
      console.error(`Error saving document ${id} content:`, error);
      // Still return the document metadata even if content storage fails
      return Response.json({ ...document, error: 'Failed to save content' }, { status: 200 });
    }
  }

  return new Response('Unauthorized', { status: 401 });
}

export async function PATCH(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  const { timestamp }: { timestamp: string } = await request.json();

  if (!id) {
    return new Response('Missing id', { status: 400 });
  }

  const session = await auth();

  if (!session || !session.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const documents = await getDocumentsById({ id });
  const document = documents[0] as Document | undefined;

  if (!document) {
    return new Response('Not Found', { status: 404 });
  }

  if (document.userId !== session.user.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  await deleteDocumentsByIdAfterTimestamp({
    id,
    timestamp: new Date(timestamp),
  });

  return new Response('Deleted', { status: 200 });
}
