/**
 * WhatsApp Cloud API configuration (Meta/Facebook).
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/get-started
 */

export const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
export const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
export const WHATSAPP_API_VERSION =
  process.env.WHATSAPP_API_VERSION ?? "v21.0";

const GRAPH_BASE = "https://graph.facebook.com";

export function getMessagesUrl(): string {
  if (!WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("WHATSAPP_PHONE_NUMBER_ID is not set");
  }
  return `${GRAPH_BASE}/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
}

export function isWhatsAppCloudConfigured(): boolean {
  return Boolean(WHATSAPP_ACCESS_TOKEN && WHATSAPP_PHONE_NUMBER_ID);
}
