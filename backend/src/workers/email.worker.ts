import "dotenv/config";
import { Job, Worker } from "bullmq";
import nodemailer from "nodemailer";
import { EMAIL_QUEUE_NAME } from "../lib/queue.js";
import { workerRedisConnection } from "../config/redis.js";
import { prisma } from "../lib/prisma.js";
import { indexEmail } from "../services/elasticsearch.service.js";
import { recoverEmailJobs } from "../services/recovery.service.js";

const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 5));
interface EmailJobData { emailId: string }

async function processEmail(job: Job<EmailJobData>) {
  const emailId = job.data.emailId;
  const claimed = await prisma.email.updateMany({ where: { id: emailId, status: "SCHEDULED" }, data: { status: "PROCESSING", attempts: { increment: 1 } } });
  if (claimed.count === 0) return { skipped: true, emailId };

  const email = await prisma.email.findUnique({ where: { id: emailId }, include: { sender: true } });
  if (!email) throw new Error(`Email ${emailId} not found`);

  try {
    const transporter = nodemailer.createTransport({
      host: email.sender.smtpHost,
      port: email.sender.smtpPort,
      secure: email.sender.smtpPort === 465,
      auth: { user: email.sender.smtpUser, pass: email.sender.smtpPassword },
    });
    const messageId = `<reachinbox-${email.id}@reachinbox.local>`;
    const result = await transporter.sendMail({
      messageId,
      from: { name: email.sender.name, address: email.sender.email },
      to: email.recipient,
      subject: email.subject,
      text: email.body,
      headers: { "X-ReachInbox-Mail": "true", "X-ReachInbox-Email-ID": email.id },
    });

    const sentAt = new Date();
    const updated = await prisma.email.updateMany({ where: { id: email.id, status: "PROCESSING" }, data: { status: "SENT", sentAt, providerMessageId: result.messageId ?? messageId, failureReason: null } });
    if (updated.count === 0) console.warn(`Email ${email.id} was changed before SENT update.`);

    await indexEmail({ emailId: email.id, campaignId: email.campaignId, userId: email.userId, senderId: email.senderId, recipient: email.recipient, subject: email.subject, status: "SENT", scheduledAt: email.scheduledAt.toISOString(), sentAt: sentAt.toISOString(), sequence: email.sequence });
    return { skipped: false, emailId: email.id, messageId: result.messageId ?? messageId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown email sending error";
    const failedAt = new Date();
    await prisma.email.updateMany({ where: { id: email.id, status: "PROCESSING" }, data: { status: "FAILED", failureReason: reason } });
    await indexEmail({ emailId: email.id, campaignId: email.campaignId, userId: email.userId, senderId: email.senderId, recipient: email.recipient, subject: email.subject, status: "FAILED", scheduledAt: email.scheduledAt.toISOString(), sentAt: null, sequence: email.sequence });
    console.error(`❌ Email failed: ${email.recipient}`, reason);
    throw error;
  }
}

async function main() {
  await recoverEmailJobs();
  const worker = new Worker<EmailJobData>(EMAIL_QUEUE_NAME, processEmail, { connection: workerRedisConnection, concurrency });
  worker.on("completed", (job) => console.log(`✅ Job completed: ${job.id}`));
  worker.on("failed", (job, error) => console.error(`❌ Job failed: ${job?.id}`, error.message));
  worker.on("error", (error) => console.error("❌ Worker error:", error));
  const shutdown = async () => { await worker.close(); await workerRedisConnection.quit(); await prisma.$disconnect(); process.exit(0); };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  console.log(`🚀 Email worker started with concurrency=${concurrency}`);
}

void main().catch((error) => { console.error("Worker startup failed:", error); process.exit(1); });
