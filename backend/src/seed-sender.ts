import "dotenv/config";
import { prisma } from "./lib/prisma.js";

async function main() {
  const user = await prisma.user.findFirst();

  if (!user) {
    throw new Error(
      "No user found. Complete Google login first.",
    );
  }

  const host = process.env.ETHEREAL_HOST;
  const port = Number(process.env.ETHEREAL_PORT ?? 587);
  const smtpUser = process.env.ETHEREAL_USER;
  const smtpPassword = process.env.ETHEREAL_PASSWORD;

  if (!host || !smtpUser || !smtpPassword) {
    throw new Error(
      "Ethereal SMTP configuration is missing.",
    );
  }

  const existingSender = await prisma.sender.findFirst({
    where: {
      userId: user.id,
    },
  });

  if (existingSender) {
    console.log("Sender already exists:");
    console.log({
      id: existingSender.id,
      name: existingSender.name,
      email: existingSender.email,
    });
    return;
  }

  const sender = await prisma.sender.create({
    data: {
      userId: user.id,
      name: user.name,
      email: smtpUser,
      smtpHost: host,
      smtpPort: port,
      smtpUser,
      smtpPassword,
    },
  });

  console.log("✅ Sender created:");
  console.log({
    id: sender.id,
    name: sender.name,
    email: sender.email,
  });
}

main()
  .catch((error) => {
    console.error("❌ Failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });