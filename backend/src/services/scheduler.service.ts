import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { emailQueue } from "../lib/queue.js";
import { reserveSendSlots } from "./rate-limiter.js";
import { indexEmail } from "./elasticsearch.service.js";
import { notifyRateLimit } from "./slack.service.js";

export interface ScheduleCampaignInput {
  userId: string;
  senderId: string;
  subject: string;
  body: string;
  recipients: string[];
  startTime: Date;
  delayMs: number;
  hourlyLimit: number;
}

export async function scheduleCampaign(input: ScheduleCampaignInput) {
  const minDelay = Number(process.env.DEFAULT_MIN_DELAY_MS ?? 1000);
  const maxRecipients = 10000;

  if (input.recipients.length === 0) throw new Error("At least one recipient is required");
  if (input.recipients.length > maxRecipients) throw new Error(`Maximum ${maxRecipients} recipients are allowed`);
  if (input.delayMs < minDelay) throw new Error(`Delay must be at least ${minDelay} ms`);
  if (input.hourlyLimit <= 0) throw new Error("Hourly limit must be greater than zero");
  if (input.startTime.getTime() < Date.now() - 60_000) throw new Error("Start time must be in the future");

  const recipients = [...new Set(input.recipients.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  if (recipients.length === 0) throw new Error("No valid recipients were provided");

  const sender = await prisma.sender.findFirst({ where: { id: input.senderId, userId: input.userId, isActive: true } });
  if (!sender) throw new Error("Sender account not found");

  const reservation = await reserveSendSlots({
    senderId: sender.id,
    startAt: input.startTime,
    count: recipients.length,
    delayMs: input.delayMs,
    hourlyLimit: input.hourlyLimit,
  });

  const campaign = await prisma.campaign.create({
    data: {
      userId: input.userId,
      senderId: sender.id,
      subject: input.subject.trim(),
      body: input.body,
      startTime: input.startTime,
      delayMs: input.delayMs,
      hourlyLimit: input.hourlyLimit,
      totalEmails: recipients.length,
    },
  });

  const emails = await prisma.$transaction(recipients.map((recipient, index) => {
    const slot = reservation.slots[index];
    if (!slot) throw new Error(`Missing reserved slot ${index}`);
    return prisma.email.create({
      data: {
        userId: input.userId,
        senderId: sender.id,
        campaignId: campaign.id,
        recipient,
        subject: input.subject.trim(),
        body: input.body,
        sequence: index,
        scheduledAt: new Date(slot.scheduledAt),
        bullmqJobId: `email:${campaign.id}:${index}`,
        idempotencyKey: `campaign:${campaign.id}:email:${index}`,
      },
    });
  }));

  const now = Date.now();
  await emailQueue.addBulk(emails.map((email) => ({
    name: "send-email",
    data: { emailId: email.id },
    opts: { jobId: email.bullmqJobId, delay: Math.max(0, email.scheduledAt.getTime() - now) },
  })));

  await Promise.all(emails.map((email) => indexEmail({
    emailId: email.id,
    campaignId: campaign.id,
    userId: input.userId,
    senderId: sender.id,
    recipient: email.recipient,
    subject: email.subject,
    status: email.status,
    scheduledAt: email.scheduledAt.toISOString(),
    sentAt: null,
    sequence: email.sequence,
  })));

  if (reservation.limitHitWindows.length > 0) {
    await notifyRateLimit(input.userId, sender.name);
  }

  return {
    campaignId: campaign.id,
    totalEmails: emails.length,
    emailsScheduled: emails.map((email) => ({ id: email.id, recipient: email.recipient, sequence: email.sequence, scheduledAt: email.scheduledAt })),
    rateLimitWindowsHit: reservation.limitHitWindows,
  };
}
