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
  next: express.NextFunction
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
 * Body: { phoneNumbers: string[], text: string, groupId?: string }
 * Sends text to each phone number in batches (await). groupId is optional for logging.
 */
app.post("/send-bulk", requireSecret, async (req, res) => {
  try {
    console.log("[Worker] send-bulk request received:", req.body);

    const { phoneNumbers, text, groupId, delaySeconds } = req.body as {
      phoneNumbers?: unknown;
      text?: unknown;
      groupId?: string;
      delaySeconds?: number;
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
        "[Worker] send-bulk validation failed: invalid or empty text"
      );
      res.status(400).json({
        success: false,
        error: "text is required and must be a non-empty string",
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
          trimmedText
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

/** GET /health - for Render health checks */
app.get("/health", (_req, res) => {
  console.log("[Worker] health check request received");
  res.json({ ok: true, service: "greenspire-whatsapp-worker" });
});

app.listen(PORT, () => {
  console.log(`[Worker] Listening on port ${PORT}`);
});
