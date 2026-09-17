import "dotenv/config";
import { emailQueue } from "./lib/queue.js";

async function main() {
    const job = await emailQueue.add(
        "test-email",
        {
            message: "Hello from ReachInbox!",
        },
        {
            delay: 5000,
            jobId: `test-${Date.now()}`,
        }
    );

    console.log(`✅ Test job added: ${job.id}`);
    console.log("⏳ It will run after 5 seconds.");
}

main().catch((error) => {
    console.error("❌ Failed to add test job:", error);
    process.exit(1);
});