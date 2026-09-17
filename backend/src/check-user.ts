import "dotenv/config";
import { prisma } from "./lib/prisma.js";

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      googleId: true,
    },
  });

  console.log("Users in database:");
  console.table(users);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });