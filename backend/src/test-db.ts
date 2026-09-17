import { prisma } from "./lib/prisma.js";

async function main() {
    await prisma.$connect();
    console.log("✅ PostgreSQL connection successful");
}

main()
    .catch((error) => {
        console.error("❌ Database connection failed:", error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });