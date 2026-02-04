import { wasender, isWasenderConfigured } from "../config/wasender.js";
import { WasenderAPIError } from "wasenderapi";

/** Normalize phone to E.164-like format for Wasender (e.g. +923001234567). */
function normalizePhone(to: string): string {
  const trimmed = to.trim();
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

/** 1 message at a time to respect "1 message every 5 seconds" account protection. */
const BULK_BATCH_SIZE = 1;
/** 6s between messages to stay clear of WhatsApp "1 message every 5 seconds" limit. */
const BULK_DELAY_MS = 6000;

export interface BulkSendResult {
  totalAttempted: number;
  sent: number;
  failed: number;
}

/**
 * Send text message to a list of phone numbers in batches with delays.
 * Used for group WhatsApp messaging; runs to completion (await).
 */
export async function sendBulkToPhones(
  phoneNumbers: string[],
  text: string
): Promise<BulkSendResult> {
  if (!isWasenderConfigured()) {
    throw new Error("WhatsApp (Wasender) is not configured");
  }
  if (
    !process.env.WASENDER_API_KEY &&
    !process.env.WASENDER_PERSONAL_ACCESS_TOKEN
  ) {
    throw new Error(
      "WASENDER_API_KEY or WASENDER_PERSONAL_ACCESS_TOKEN is required"
    );
  }

  const normalized = phoneNumbers
    .map((n) => normalizePhone(n))
    .filter((n) => n.length > 1);

  console.log("[Worker] sendBulkToPhones: starting", {
    inputCount: phoneNumbers.length,
    normalizedCount: normalized.length,
  });

  if (normalized.length === 0) {
    console.log("[Worker] sendBulkToPhones: no valid phones, skipping");
    return { totalAttempted: 0, sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < normalized.length; i += BULK_BATCH_SIZE) {
    const batch = normalized.slice(i, i + BULK_BATCH_SIZE);
    console.log("[Worker] Batch:", {
      batchNumber: Math.floor(i / BULK_BATCH_SIZE) + 1,
      size: batch.length,
      totalProcessed: i,
      total: normalized.length,
    });

    await Promise.all(
      batch.map((to) =>
        wasender
          .send({ messageType: "text", to, text })
          .then(() => {
            sent++;
            console.log("[Worker] Sent to", to);
          })
          .catch((err: unknown) => {
            failed++;
            const msg =
              err instanceof WasenderAPIError ? err.apiMessage : String(err);
            console.error("[Worker] Failed to send to", to, msg);
          })
      )
    );

    const hasMore = i + BULK_BATCH_SIZE < normalized.length;
    if (hasMore) {
      console.log("[Worker] Waiting", BULK_DELAY_MS, "ms before next batch");
      await new Promise((r) => setTimeout(r, BULK_DELAY_MS));
    }
  }

  console.log("[Worker] Bulk send completed:", {
    totalAttempted: normalized.length,
    sent,
    failed,
  });

  return {
    totalAttempted: normalized.length,
    sent,
    failed,
  };
}
