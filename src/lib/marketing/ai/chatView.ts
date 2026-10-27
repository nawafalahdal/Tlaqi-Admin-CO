import type { chatView } from "./chat";

/** المحادثةُ كما تصل إلى المتصفّح: نصوصٌ وحالاتٌ وأوقاتٌ نصّية — بلا مزوّدٍ ولا بصمةٍ ولا رموز */
export type ChatViewData = ReturnType<typeof serializeChat>;

export function serializeChat(v: NonNullable<Awaited<ReturnType<typeof chatView>>>) {
  return {
    threadId: v.threadId,
    canWrite: v.canWrite,
    blocked: v.blocked,
    ai: v.ai,
    paused: v.paused,
    me: v.me,
    messages: v.messages.map((m) => ({
      id: m.id,
      role: m.role,
      body: m.body,
      status: m.status,
      error: m.error,
      attempts: m.attempts,
      maxAttempts: m.maxAttempts,
      mine: m.role === "user" && m.authorId === v.me,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}
