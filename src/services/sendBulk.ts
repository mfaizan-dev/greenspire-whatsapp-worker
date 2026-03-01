import { isWhatsAppCloudConfigured } from "../config/whatsappCloud.js";
import {
  sendTextMessage,
  toE164Digits,
} from "./whatsappCloudApi.js";

/** 1 message at a time to respect rate limits. */
const BULK_BATCH_SIZE = 1;
/** Delay between messages (Meta tier-based limits). */
const CLOUD_API_DELAY_MS = 1000;

export interface BulkSendOptions {
  /** Enable link preview for URLs in the message. */
  previewUrl?: boolean;
}

export interface BulkSendResult {
  totalAttempted: number;
  sent: number;
  failed: number;
}

/**
 * Send text message to a list of phone numbers via WhatsApp Cloud API.
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/messages/text-messages
 */
export async function sendBulkToPhones(
  phoneNumbers: string[],
  text: string,
  options: BulkSendOptions = {}
): Promise<BulkSendResult> {
  if (!isWhatsAppCloudConfigured()) {
    throw new Error(
      "WhatsApp Cloud API is not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID."
    );
  }

  const normalized = phoneNumbers
    .map((n) => toE164Digits(n))
    .filter((n) => n.length >= 10);

  console.log("[Worker] sendBulk: starting", {
    inputCount: phoneNumbers.length,
    normalizedCount: normalized.length,
  });

  if (normalized.length === 0) {
    console.log("[Worker] sendBulk: no valid phones, skipping");
    return { totalAttempted: 0, sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < normalized.length; i += BULK_BATCH_SIZE) {
    const batch = normalized.slice(i, i + BULK_BATCH_SIZE);
    console.log("[Worker] Batch:", {
      batchNumber: Math.floor(i / BULK_BATCH_SIZE) + 1,
      totalProcessed: i,
      total: normalized.length,
    });

    await Promise.all(
      batch.map((to) =>
        sendTextMessage(to, text, { previewUrl: options.previewUrl })
          .then(() => {
            sent++;
            console.log("[Worker] Sent to", to);
          })
          .catch((err: unknown) => {
            failed++;
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[Worker] Failed to send to", to, msg);
          })
      )
    );

    const hasMore = i + BULK_BATCH_SIZE < normalized.length;
    if (hasMore) {
      await new Promise((r) => setTimeout(r, CLOUD_API_DELAY_MS));
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
