import "dotenv/config";
import { prisma } from "./lib/prisma.js";
import { scheduleCampaign } from "./services/scheduler.service.js";

async function main() {
  const user = await prisma.user.findFirst();

  if (!user) {
    throw new Error("No user found");
  }

  const sender = await prisma.sender.findFirst({
    where: {
      userId: user.id,
      isActive: true,
    },
  });

  if (!sender) {
    throw new Error("No active sender found");
  }

  const startTime = new Date(Date.now() + 10_000);

  const result = await scheduleCampaign({
    userId: user.id,
    senderId: sender.id,

    subject: "ReachInbox Scheduler Test",

    body:
      "This is a test email from the ReachInbox email scheduler.",

    recipients: [
      "test-recipient-1@example.com",
      "test-recipient-2@example.com",
    ],

    startTime,

    delayMs: 2_000,

    hourlyLimit: 100,
  });

  console.log("✅ Test campaign scheduled");
  console.dir(result, { depth: null });
}

main()
  .catch((error) => {
    console.error("❌ Test scheduling failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });