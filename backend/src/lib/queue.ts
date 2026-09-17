import { Queue } from "bullmq";
import { redisConnection } from "../config/redis.js";

export const EMAIL_QUEUE_NAME = "email-scheduler";

export const emailQueue = new Queue(EMAIL_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: {
      age: 24 * 60 * 60,
    },
    removeOnFail: {
      age: 7 * 24 * 60 * 60,
    },
  },
});