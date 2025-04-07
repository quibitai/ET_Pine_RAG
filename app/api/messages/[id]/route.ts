import { auth } from '@/app/(auth)/auth';
import { getMessageById } from '@/lib/db/queries';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return new Response('Unauthorized', { status: 401 });
    }

    const messages = await getMessageById({ id: params.id });
    if (!messages || messages.length === 0) {
      return new Response('Message not found', { status: 404 });
    }

    const message = messages[0];
    return new Response(JSON.stringify({
      id: message.id,
      metadata: message.metadata
    }), {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Error fetching message:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
} 