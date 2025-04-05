import { auth } from '@/app/(auth)/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import KnowledgeBaseClient from './knowledge-base-client';

export const dynamic = 'force-dynamic';

export default async function KnowledgeBasePage() {
  const session = await auth();
  const user = session?.user;

  // If not logged in, redirect to login
  if (!user) {
    redirect('/login');
  }

  const headersList = headers();
  const referrer = headersList.get('referer') || '/';

  return (
    <div className="flex flex-col items-start justify-between p-6">
      <div className="w-full mx-auto space-y-4 max-w-5xl">
        <h1 className="text-2xl font-bold">Knowledge Base</h1>
        <KnowledgeBaseClient user={user} />
      </div>
    </div>
  );
} 