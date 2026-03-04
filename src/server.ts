import "dotenv/config";
import express from "express";
import cors from "cors";
import { sendBulkToPhones } from "./services/sendBulk.js";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

/** Optional: require WORKER_SECRET header to avoid public abuse. Set on Render. */
const WORKER_SECRET = process.env.WORKER_SECRET;

function requireSecret(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (!WORKER_SECRET) {
    return next();
  }
  const value =
    req.headers.authorization?.replace(/^Bearer\s+/i, "") ??
    req.headers["x-worker-secret"];
  if (value !== WORKER_SECRET) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }
  next();
}

/**
* POST /send-bulk
* Body: {
*   phoneNumbers: string[],
*   text: string,
*   groupId?: string,
*   delaySeconds?: number,
*   templateName: string,
*   languageCode: string,
*   headerText?: string
* }
* Sends template messages via WhatsApp Cloud API in batches with rate limiting.
* groupId: optional for logging.
*/
app.post("/send-bulk", requireSecret, async (req, res) => {
  try {
    console.log("[Worker] send-bulk request received:", req.body);

    const {
      phoneNumbers,
      text,
      groupId,
      delaySeconds,
      templateName,
      languageCode,
      headerText,
    } = req.body as {
      phoneNumbers?: unknown;
      text?: unknown;
      groupId?: string;
      delaySeconds?: number;
      templateName?: string;
      languageCode?: string;
      headerText?: string;
    };

    if (
      !Array.isArray(phoneNumbers) ||
      !phoneNumbers.every((n) => typeof n === "string")
    ) {
      console.log("[Worker] send-bulk validation failed: invalid phoneNumbers");
      res.status(400).json({
        success: false,
        error: "phoneNumbers must be a non-empty array of strings",
      });
      return;
    }
    if (typeof text !== "string" || !text.trim()) {
      console.log(
        "[Worker] send-bulk validation failed: invalid or empty text",
      );
      res.status(400).json({
        success: false,
        error: "text is required and must be a non-empty string",
      });
      return;
    }
    if (typeof templateName !== "string" || !templateName.trim()) {
      console.log(
        "[Worker] send-bulk validation failed: invalid or empty templateName",
      );
      res.status(400).json({
        success: false,
        error: "templateName is required and must be a non-empty string",
      });
      return;
    }
    if (typeof languageCode !== "string" || !languageCode.trim()) {
      console.log(
        "[Worker] send-bulk validation failed: invalid or empty languageCode",
      );
      res.status(400).json({
        success: false,
        error: "languageCode is required and must be a non-empty string",
      });
      return;
    }

    const count = (phoneNumbers as string[]).length;
    const trimmedText = text.trim();

    console.log("[Worker] send-bulk accepted:", {
      count,
      groupId: groupId ?? null,
      delaySeconds: delaySeconds ?? null,
    });

    // Respond immediately so Vercel/frontend don't wait (e.g. 500 members = long run).
    res.status(202).json({
      success: true,
      accepted: true,
      count,
      groupId: groupId ?? null,
      message: "Chunk accepted; messages will be sent in the background.",
    });

    // Process in background (delay + send).
    (async () => {
      const delay =
        typeof delaySeconds === "number" && delaySeconds > 0
          ? Math.min(delaySeconds, 86400)
          : 0;
      if (delay > 0) {
        console.log("[Worker] Staggering chunk: waiting", delay, "seconds");
        await new Promise((r) => setTimeout(r, delay * 1000));
      }
      try {
        const result = await sendBulkToPhones(
          phoneNumbers as string[],
          trimmedText,
          {
            templateName: templateName.trim(),
            languageCode: languageCode.trim(),
            headerText: typeof headerText === "string" ? headerText : undefined,
          },
        );
        console.log("[Worker] send-bulk completed:", {
          groupId: groupId ?? null,
          ...result,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[Worker] send-bulk background error:", message);
      }
    })();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Worker] send-bulk error:", message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

// ---------------------------------------------------------------------------
// WhatsApp Cloud API Webhook (for Meta to send message status updates, etc.)
// Configure this URL in Meta App: WhatsApp > Configuration > Webhook
// ---------------------------------------------------------------------------
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

/** GET /webhook - Meta verification (required when you first set the webhook URL) */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe") {
    // If WEBHOOK_VERIFY_TOKEN is set, Meta's token must match; if not set, any token is accepted
    if (WEBHOOK_VERIFY_TOKEN && token !== WEBHOOK_VERIFY_TOKEN) {
      console.warn("[Webhook] Verify token mismatch");
      res.status(403).send("Forbidden");
      return;
    }
    console.log("[Webhook] Verified successfully");
    res.status(200).send(challenge);
    return;
  }
  res.status(400).send("Bad request");
});

/** POST /webhook - Meta sends message status updates (accepted, sent, delivered, read, failed) and incoming messages */
app.post("/webhook", (req, res) => {
  // Always respond 200 quickly so Meta doesn't retry
  res.status(200).send("OK");

  const body = req.body as Record<string, unknown>;
  // Debug: log full payload (helps trace why messages stay "accepted" and never "delivered")
  console.log("[Webhook] Raw payload:", JSON.stringify(body, null, 2));

  const object = body?.object;
  if (object !== "whatsapp_business_account") {
    console.log("[Webhook] Ignoring non-WABA object:", object);
    return;
  }

  const entries = body?.entry as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(entries)) {
    console.log("[Webhook] No entries in payload");
    return;
  }

  for (const entry of entries) {
    const id = entry?.id;
    const changes = entry?.changes as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const field = change?.field;
      const value = change?.value as Record<string, unknown> | undefined;
      if (!value) continue;

      if (field === "messages") {
        // Message status updates (accepted → sent → delivered → read) or failures
        const statuses = value?.statuses as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(statuses)) {
          for (const s of statuses) {
            const msgId = s?.id;
            const status = s?.status;
            const recipientId = s?.recipient_id;
            const timestamp = s?.timestamp;
            const errors = s?.errors;
            console.log("[Webhook] Message status:", {
              messageId: msgId,
              status,
              recipientId,
              timestamp: timestamp != null ? new Date(Number(timestamp) * 1000).toISOString() : undefined,
              errors: errors ?? undefined,
            });
            if (status === "failed" && errors) {
              console.error("[Webhook] Delivery failed:", JSON.stringify(errors));
            }
          }
        }
        // Incoming messages (if you need to log them)
        const messages = value?.messages as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(messages)) {
          for (const m of messages) {
            console.log("[Webhook] Incoming message:", {
              from: m?.from,
              id: m?.id,
              type: m?.type,
              timestamp: m?.timestamp,
            });
          }
        }
      }
    }
  }
});

/** GET /health - for Render health checks */
app.get("/health", (_req, res) => {
  console.log("[Worker] health check request received");
  res.json({ ok: true, service: "greenspire-whatsapp-worker" });
});

app.listen(PORT, () => {
  console.log(`[Worker] Listening on port ${PORT}`);
});
