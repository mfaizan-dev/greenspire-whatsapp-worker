/**
 * WhatsApp Cloud API client for sending text messages.
 * Follows official Meta docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

import {
  WHATSAPP_ACCESS_TOKEN,
  getMessagesUrl,
  isWhatsAppCloudConfigured,
} from "../config/whatsappCloud.js";

/** Max body length for text messages (Cloud API limit). */
const MAX_TEXT_BODY_LENGTH = 4096;

/** Normalize to digits only for the Cloud API "to" field (E.164 without +). */
export function toE164Digits(phone: string): string {
  return phone.trim().replace(/\D/g, "");
}

export interface SendTextOptions {
  /** Enable link preview for http(s) URLs in the body. Default false. */
  previewUrl?: boolean;
}

export interface SendTextResult {
  messageId: string;
}

export interface WhatsAppCloudError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

/**
 * Send a single text message via WhatsApp Cloud API.
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/messages/text-messages
 */
export async function sendTextMessage(
  to: string,
  body: string,
  options: SendTextOptions = {}
): Promise<SendTextResult> {
  if (!isWhatsAppCloudConfigured()) {
    throw new Error(
      "WhatsApp Cloud API is not configured (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID)"
    );
  }
  if (!WHATSAPP_ACCESS_TOKEN) {
    throw new Error("WHATSAPP_ACCESS_TOKEN is required");
  }

  const recipient = toE164Digits(to);
  if (!recipient) {
    throw new Error("Invalid recipient phone number");
  }

  const truncatedBody =
    body.length > MAX_TEXT_BODY_LENGTH
      ? body.slice(0, MAX_TEXT_BODY_LENGTH)
      : body;

  const url = getMessagesUrl();
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipient,
    type: "text",
    text: {
      preview_url: Boolean(options.previewUrl),
      body: truncatedBody,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  const data = (await res.json()) as
    | { messages?: Array<{ id: string }> }
    | WhatsAppCloudError;

  if (!res.ok) {
    const err = data as WhatsAppCloudError;
    const msg =
      err?.error?.message ?? `HTTP ${res.status}: ${res.statusText}`;
    throw new Error(`WhatsApp Cloud API error: ${msg}`);
  }

  const success = data as { messages?: Array<{ id: string }> };
  const messageId = success?.messages?.[0]?.id;
  if (!messageId) {
    throw new Error("WhatsApp Cloud API did not return a message ID");
  }

  return { messageId };
}
