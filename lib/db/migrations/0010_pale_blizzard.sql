ALTER TABLE "documents" ALTER COLUMN "userId" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "title" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "User" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "User" ALTER COLUMN "email" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "name" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_userId_idx" ON "Chat" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_userId_idx" ON "documents" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_chatId_idx" ON "Message_v2" USING btree ("chatId");--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN IF EXISTS "password";