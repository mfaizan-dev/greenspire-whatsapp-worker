# Greenspire WhatsApp Worker

Small Node.js service that runs **background group WhatsApp messaging** (batched send). Deploy this on **Render** so it can run longer than Vercel’s serverless timeout. The main backend stays on Vercel and forwards group-send requests here.

## Flow

1. User triggers “Send to group” in the app.
2. **Vercel backend** loads the group, resolves contacts to phone numbers, then `POST`s to this worker’s `/send-bulk` with `{ phoneNumbers, text, groupId }`.
3. **This worker** sends messages in batches (e.g. 5 at a time with 3s delay) and responds when done.

## Run locally

```bash
cp .env.example .env
# Edit .env: set WASENDER_API_KEY (or WASENDER_PERSONAL_ACCESS_TOKEN)
npm install
npm run dev
```

Test:

```bash
curl -X POST http://localhost:3000/send-bulk \
  -H "Content-Type: application/json" \
  -d '{"phoneNumbers":["+923001234567"],"text":"Test message"}'
```

## Deploy on Render

1. **New** → **Web Service**.
2. Connect this repo and set **Root Directory** to `greenspire-whatsapp-worker`.
3. **Build command:** `npm install && npm run build`
4. **Start command:** `npm start`
5. **Environment:** add `WASENDER_API_KEY` (or `WASENDER_PERSONAL_ACCESS_TOKEN`). Optionally add `WORKER_SECRET` and set the same value as `WHATSAPP_WORKER_SECRET` on Vercel so only your backend can call the worker.

After deploy, set on **Vercel** (main backend):

- `WHATSAPP_WORKER_URL=https://your-worker.onrender.com`
- Optionally: `WHATSAPP_WORKER_SECRET=<same as WORKER_SECRET on Render>`

## API

- **POST /send-bulk**  
  Body: `{ phoneNumbers: string[], text: string, groupId?: string }`  
  Sends `text` to each number in batches. Returns `{ success, sent, failed, totalAttempted, groupId }`.  
  If `WORKER_SECRET` is set, send it as `Authorization: Bearer <secret>` or `X-Worker-Secret: <secret>`.

- **GET /health**  
  Returns `{ ok: true }` for Render health checks.
