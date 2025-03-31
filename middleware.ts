import NextAuth from 'next-auth';

import { authConfig } from '@/app/(auth)/auth.config';

export default NextAuth(authConfig).auth;

export const config = {
  // Match everything EXCEPT specific API routes like the QStash worker
  matcher: [
    '/((?!api/rag-worker|_next/static|_next/image|favicon.ico).*)',
  ],
};
