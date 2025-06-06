import {
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SQSClient,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import { Queue } from "../../src/aws/queue.ts";
import { destroy } from "../../src/destroy.ts";
import { BRANCH_PREFIX } from "../util.ts";

import "../../src/test/vitest.ts";

const test = alchemy.test(import.meta, {
  prefix: BRANCH_PREFIX,
});

const sqs = new SQSClient({});

describe("AWS Resources", () => {
  describe("Queue", () => {
    test("create queue", async (scope) => {
      const queueName = `${BRANCH_PREFIX}-alchemy-test-queue`;

      try {
        const queue = await Queue(queueName, {
          queueName,
          fifo: false,
          visibilityTimeout: 30,
          tags: {
            Environment: "test",
          },
        });
        expect(queue.url).toMatch(
          new RegExp(
            `https:\\/\\/sqs\\.[a-z0-9-]+\\.amazonaws\\.com\\/\\d+\\/${queueName}$`,
          ),
        );
        expect(queue.arn).toMatch(
          new RegExp(`^arn:aws:sqs:[a-z0-9-]+:\\d+:${queueName}$`),
        );
        expect(queue.tags).toEqual({
          Environment: "test",
        });

        // Verify queue exists with proper attributes
        const getQueueUrlResponse = await sqs.send(
          new GetQueueUrlCommand({
            QueueName: queueName,
          }),
        );

        const getQueueAttributesResponse = await sqs.send(
          new GetQueueAttributesCommand({
            QueueUrl: getQueueUrlResponse.QueueUrl,
            AttributeNames: ["All"],
          }),
        );

        expect(getQueueAttributesResponse.Attributes?.VisibilityTimeout).toBe(
          "30",
        );
      } finally {
        // Always clean up, even if test assertions fail
        await destroy(scope);
        // Verify queue is gone (this will throw if queue doesn't exist)
        const queueExists = await waitUntilQueueDoesNotExist(sqs, queueName);
        expect(queueExists).toBe(false);
      }
    });

    test("create fifo queue", async (scope) => {
      // For FIFO queues, the name must end with .fifo suffix
      const queueName = `${BRANCH_PREFIX}-alchemy-test-fifo-queue.fifo`;

      try {
        const queue = await Queue(queueName, {
          queueName,
          fifo: true,
          visibilityTimeout: 30,
          contentBasedDeduplication: true,
          tags: {
            Environment: "test",
          },
        });
        expect(queue.url).toMatch(
          new RegExp(
            `https:\\/\\/sqs\\.[a-z0-9-]+\\.amazonaws\\.com\\/\\d+\\/${queueName.replace(/\./g, "\\.")}$`,
          ),
        );
        expect(queue.fifo).toBe(true);
        expect(queue.contentBasedDeduplication).toBe(true);

        // Verify queue exists with proper attributes
        const getQueueUrlResponse = await sqs.send(
          new GetQueueUrlCommand({
            QueueName: queueName,
          }),
        );

        const getQueueAttributesResponse = await sqs.send(
          new GetQueueAttributesCommand({
            QueueUrl: getQueueUrlResponse.QueueUrl,
            AttributeNames: ["All"],
          }),
        );

        expect(getQueueAttributesResponse.Attributes?.FifoQueue).toBe("true");
        expect(
          getQueueAttributesResponse.Attributes?.ContentBasedDeduplication,
        ).toBe("true");
      } finally {
        // Always clean up, even if test assertions fail
        await destroy(scope);
      }
    });

    test("create quee, send message, delete, and recreate", async (scope) => {
      // Create initial queue
      const queueName = `${BRANCH_PREFIX}-alchemy-test-queue-recreate`;

      try {
        const queue = await Queue(queueName, {
          queueName,
          fifo: false,
          visibilityTimeout: 30,
        });
        expect(queue.arn).toMatch(
          new RegExp(`^arn:aws:sqs:[a-z0-9-]+:\\d+:${queueName}$`),
        );
        expect(queue.url).toMatch(
          new RegExp(
            `^https:\\/\\/sqs\\.[a-z0-9-]+\\.amazonaws\\.com\\/\\d+\\/${queueName}$`,
          ),
        );

        // Send a test message
        const messageResponse = await sqs.send(
          new SendMessageCommand({
            QueueUrl: queue.url,
            MessageBody: "Hello from test!",
          }),
        );
        expect(messageResponse.MessageId).toBeTruthy();

        // Delete the queue
        await destroy(queue);

        // Wait for the queue to be fully deleted due to eventual consistency
        const queueExists = await waitUntilQueueDoesNotExist(sqs, queueName);
        expect(queueExists).toBe(false);

        // Immediately try to recreate the queue - this should handle the QueueDeletedRecently error
        const recreatedQueue = await Queue(queueName, {
          queueName,
          visibilityTimeout: 30,
          messageRetentionPeriod: 345600,
          tags: {
            Environment: "test",
          },
        });

        expect(recreatedQueue.arn).toMatch(
          new RegExp(`^arn:aws:sqs:[a-z0-9-]+:\\d+:${queueName}$`),
        );
        expect(recreatedQueue.url).toMatch(
          new RegExp(
            `^https:\\/\\/sqs\\.[a-z0-9-]+\\.amazonaws\\.com\\/\\d+\\/${queueName}$`,
          ),
        );
      } finally {
        // In case the initial queue creation or tests fail
        await destroy(scope); // Ignore errors on cleanup
      }
    });
  });
});

/**
 * Wait until an SQS queue no longer exists, handling eventual consistency
 *
 * AWS SQS control plane operations are eventually consistent, so after deleting
 * a queue it may still appear to exist for some time. This utility polls until
 * the queue is truly gone or times out.
 *
 * @param sqs SQS client instance
 * @param queueName Name of the queue to check
 * @param timeoutMs Maximum time to wait in milliseconds (default: 60000ms)
 * @param intervalMs Time between checks in milliseconds (default: 2000ms)
 * @returns Promise<boolean> true if queue still exists after timeout, false if queue is gone
 */
export async function waitUntilQueueDoesNotExist(
  sqs: SQSClient,
  queueName: string,
  timeoutMs = 60000,
  intervalMs = 2000,
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }));
      // If we get here, the queue still exists, wait and try again
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    } catch (error) {
      // If GetQueueUrl throws, the queue doesn't exist anymore
      if (
        error instanceof Error &&
        error.message.includes("The specified queue does not exist")
      ) {
        return false; // Queue is gone
      }
      // For other errors, continue waiting
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  // Timeout reached, queue still exists
  return true;
}
