import { prisma } from "../lib/prisma.js";
import { emailQueue } from "../lib/queue.js";

const PROCESSING_STALE_MS = Number(process.env.PROCESSING_STALE_MS ?? 15 * 60 * 1000);

export async function recoverEmailJobs(): Promise<void> {
  const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS);

  await prisma.email.updateMany({
    where: { status: "PROCESSING", updatedAt: { lt: staleBefore } },
    data: { status: "SCHEDULED", failureReason: "Recovered after worker interruption" },
  });

  const pending = await prisma.email.findMany({
    where: { status: "SCHEDULED" },
    select: { id: true, bullmqJobId: true, scheduledAt: true },
    orderBy: { scheduledAt: "asc" },
  });

  for (const email of pending) {
    const existing = await emailQueue.getJob(email.bullmqJobId);
    if (existing) continue;

    await emailQueue.add("send-email", { emailId: email.id }, {
      jobId: email.bullmqJobId,
      delay: Math.max(0, email.scheduledAt.getTime() - Date.now()),
    });
  }

  console.log(`♻️ Recovery checked ${pending.length} scheduled emails.`);
}
