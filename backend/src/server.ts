import "dotenv/config";
import app from "./app.js";
import { recoverEmailJobs } from "./services/recovery.service.js";

const PORT = Number(process.env.PORT ?? 5000);

void recoverEmailJobs().catch((error) => console.error("Startup recovery warning:", error instanceof Error ? error.message : error));

app.listen(PORT, () => console.log(`🚀 ReachInbox API running on http://localhost:${PORT}`));
