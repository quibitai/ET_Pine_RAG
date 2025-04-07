import { auth } from '@/app/(auth)/auth';
import { deleteChatById, getChatById } from '@/lib/db/queries';

/**
 * DELETE handler for deleting a chat
 * Expected query parameter: ?id=chatId
 */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return new Response('Missing id parameter', { status: 400 });
    }

    const session = await auth();

    if (!session || !session.user || !session.user.id) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Verify that the chat exists and belongs to the current user
    const chat = await getChatById({ id });

    if (!chat) {
      return new Response('Chat not found', { status: 404 });
    }

    if (chat.userId !== session.user.id) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Delete the chat and related data
    await deleteChatById({ id });

    return new Response('Chat deleted successfully', { status: 200 });
  } catch (error) {
    console.error('Error deleting chat:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
} 