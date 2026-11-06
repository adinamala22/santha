-- ADR-028: support chat between customers, stores, riders and Santha support.
CREATE TABLE "support_threads" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "app" TEXT NOT NULL,
    "order_id" UUID,
    "order_code" TEXT,
    "topic" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assignee_id" UUID,
    "last_message_at" TIMESTAMPTZ(6) NOT NULL,
    "last_message_preview" TEXT NOT NULL,
    "unread_by_user" INTEGER NOT NULL DEFAULT 0,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "author" TEXT NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_threads_status_last_message_at_idx" ON "support_threads"("status", "last_message_at");
CREATE INDEX "support_threads_user_id_last_message_at_idx" ON "support_threads"("user_id", "last_message_at");
CREATE INDEX "support_threads_order_id_idx" ON "support_threads"("order_id");
CREATE INDEX "support_messages_thread_id_created_at_idx" ON "support_messages"("thread_id", "created_at");

ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "support_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
