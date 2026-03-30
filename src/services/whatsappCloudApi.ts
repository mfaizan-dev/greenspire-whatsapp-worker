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

function maskPhone(phone: string): string {
  return phone.replace(/\d(?=\d{4})/g, "*");
}

/**
 * WhatsApp template text params cannot contain new lines/tabs
 * and must not include more than 4 consecutive spaces.
 */
function sanitizeTemplateParamText(input: string): string {
  return input
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {5,}/g, "    ")
    .trim();
}

export interface SendTextOptions {
  /** Template name configured in WhatsApp Cloud API. */
  templateName: string;
  /** Language code for the template, e.g. "en" or "ur". */
  languageCode: string;
  /** Optional header text parameter for the template. */
  headerText?: string;
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
    error_data?: { details?: string } | Record<string, unknown>;
    fbtrace_id?: string;
  };
}

/**
 * Send a single template message via WhatsApp Cloud API.
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/messages/message-templates
 */
export async function sendTextMessage(
  to: string,
  body: string,
  options: SendTextOptions = {
    templateName: "hello_world",
    languageCode: "en",
  },
): Promise<SendTextResult> {
  if (!isWhatsAppCloudConfigured()) {
    throw new Error(
      "WhatsApp Cloud API is not configured (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID)",
    );
  }
  if (!WHATSAPP_ACCESS_TOKEN) {
    throw new Error("WHATSAPP_ACCESS_TOKEN is required");
  }

  const recipient = toE164Digits(to);
  if (!recipient) {
    throw new Error("Invalid recipient phone number");
  }

  console.log("[WhatsApp Cloud API] Sending text message", {
    to: maskPhone(recipient),
    bodyLength: body.length,
    templateName: options.templateName,
    languageCode: options.languageCode,
    hasHeaderText: Boolean(options.headerText),
  });

  const truncatedBody =
    body.length > MAX_TEXT_BODY_LENGTH
      ? body.slice(0, MAX_TEXT_BODY_LENGTH)
      : body;
  if (body.length > MAX_TEXT_BODY_LENGTH) {
    console.log("[WhatsApp Cloud API] Body truncated", {
      original: body.length,
      max: MAX_TEXT_BODY_LENGTH,
    });
  }

  const url = getMessagesUrl();
  const sanitizedHeader = options.headerText
    ? sanitizeTemplateParamText(options.headerText)
    : undefined;
  const sanitizedBody = sanitizeTemplateParamText(truncatedBody);

  if (options.headerText && sanitizedHeader !== options.headerText) {
    console.log("[WhatsApp Cloud API] Header text sanitized", {
      to: maskPhone(recipient),
      originalLength: options.headerText.length,
      sanitizedLength: sanitizedHeader?.length ?? 0,
    });
  }
  if (sanitizedBody !== truncatedBody) {
    console.log("[WhatsApp Cloud API] Body text sanitized", {
      to: maskPhone(recipient),
      originalLength: truncatedBody.length,
      sanitizedLength: sanitizedBody.length,
    });
  }

  const components: Array<{
    type: string;
    parameters: Array<{ type: string; text: string }>;
  }> = [];

  if (sanitizedHeader) {
    components.push({
      type: "header",
      parameters: [
        {
          type: "text",
          text: sanitizedHeader,
        },
      ],
    });
  }

  if (sanitizedBody) {
    components.push({
      type: "body",
      parameters: [
        {
          type: "text",
          text: sanitizedBody,
        },
      ],
    });
  }

  const payload: any = {
    messaging_product: "whatsapp",
    to: recipient,
    type: "template",
    template: {
      name: options.templateName,
      language: {
        code: options.languageCode,
      },
    },
  };

  if (components.length > 0) {
    payload.template.components = components;
  }

  console.log("[WhatsApp Cloud API] Payload prepared", {
    to: maskPhone(recipient),
    url,
    templateName: options.templateName,
    languageCode: options.languageCode,
    componentCount: components.length,
    components: components.map((c) => ({
      type: c.type,
      parameterCount: c.parameters.length,
      textLengths: c.parameters.map((p) => p.text.length),
    })),
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json();

  console.log("[WhatsApp Cloud API] Response", {
    status: res.status,
    statusText: res.statusText,
    to: maskPhone(recipient),
    response: json,
  });

  const data = json as
    | { messages?: Array<{ id: string }> }
    | WhatsAppCloudError;

  if (!res.ok) {
    const err = data as WhatsAppCloudError;
    const msg = err?.error?.message ?? `HTTP ${res.status}: ${res.statusText}`;
    const details =
      typeof err?.error?.error_data === "object"
        ? JSON.stringify(err.error.error_data)
        : undefined;
    console.error("[WhatsApp Cloud API] Send failed", {
      status: res.status,
      statusText: res.statusText,
      to: maskPhone(recipient),
      error: msg,
      code: err?.error?.code,
      subcode: err?.error?.error_subcode,
      fbtraceId: err?.error?.fbtrace_id,
      details,
      templateName: options.templateName,
      languageCode: options.languageCode,
      sentComponents: payload?.template?.components ?? [],
    });
    throw new Error(
      `WhatsApp Cloud API error: ${msg}${details ? ` | details: ${details}` : ""}`,
    );
  }

  const success = data as { messages?: Array<{ id: string }> };
  const messageId = success?.messages?.[0]?.id;
  if (!messageId) {
    console.error("[WhatsApp Cloud API] Unexpected response: no message ID", {
      to: maskPhone(recipient),
      response: data,
    });
    throw new Error("WhatsApp Cloud API did not return a message ID");
  }

  console.log("[WhatsApp Cloud API] Message sent", {
    messageId,
    to: maskPhone(recipient),
  });
  return { messageId };
}
