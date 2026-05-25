import { NextResponse } from "next/server";

import {
  chatWithEcommerceAssistant,
  registerEcommercePaymentProof,
  resetEcommerceConversation,
} from "@/server/ecommerce-assistant";
import { generateElevenLabsSpeech, isElevenLabsConfigured } from "@/server/elevenlabs-service";
import { sendAudioMessage, sendMessage } from "@/server/messageService";
import { transcribeOpenAIAudio } from "@/server/openai-service";

export const runtime = "nodejs";

type UltraMsgWebhookPayload = {
  event_type?: string;
  instanceId?: string;
  data?: {
    id?: string;
    from?: string;
    to?: string;
    body?: string;
    caption?: string;
    type?: string;
    mimetype?: string;
    mimeType?: string;
    filename?: string;
    fromMe?: boolean;
    time?: number;
  } & Record<string, unknown>;
};

type DownloadedMedia = {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
};

type SafeModeState = {
  processedMessageIds: Map<string, number>;
  hourlyReplyTimestamps: number[];
  hourlyReplyTimestampsBySender: Map<string, number[]>;
};

const globalForUltraMsgSafety = globalThis as unknown as {
  __ultraMsgSafetyState?: SafeModeState;
};

const SUPPORTED_MEDIA_TYPES = new Set([
  "audio",
  "ptt",
  "voice",
  "image",
  "document",
]);
const SAFE_MODE_REPLY_LIMIT_PER_HOUR = 10;
const SAFE_MODE_PROCESSED_MESSAGE_TTL_MS = 6 * 60 * 60 * 1000;
const SAFE_MODE_RATE_WINDOW_MS = 60 * 60 * 1000;
const SAFE_MODE_MIN_REPLY_DELAY_MS = 8_000;
const SAFE_MODE_MAX_REPLY_DELAY_MS = 15_000;

function getSafeModeState() {
  if (!globalForUltraMsgSafety.__ultraMsgSafetyState) {
    globalForUltraMsgSafety.__ultraMsgSafetyState = {
      processedMessageIds: new Map(),
      hourlyReplyTimestamps: [],
      hourlyReplyTimestampsBySender: new Map(),
    };
  }

  return globalForUltraMsgSafety.__ultraMsgSafetyState;
}

function isWhatsAppSafeMode() {
  return process.env.WHATSAPP_SAFE_MODE?.trim().toLowerCase() === "true";
}

function getAudioTranscriptionLanguage() {
  return process.env.ECOMMERCE_LANGUAGE?.trim().toLowerCase() === "en" ? "en" : "es";
}

function cleanupSafetyState(now = Date.now()) {
  const state = getSafeModeState();

  for (const [messageId, createdAt] of state.processedMessageIds) {
    if (now - createdAt > SAFE_MODE_PROCESSED_MESSAGE_TTL_MS) {
      state.processedMessageIds.delete(messageId);
    }
  }

  state.hourlyReplyTimestamps = state.hourlyReplyTimestamps.filter(
    (timestamp) => now - timestamp <= SAFE_MODE_RATE_WINDOW_MS,
  );

  for (const [sender, timestamps] of state.hourlyReplyTimestampsBySender) {
    const recent = timestamps.filter((timestamp) => now - timestamp <= SAFE_MODE_RATE_WINDOW_MS);

    if (recent.length) {
      state.hourlyReplyTimestampsBySender.set(sender, recent);
    } else {
      state.hourlyReplyTimestampsBySender.delete(sender);
    }
  }
}

function getInboundMessageId(payload: UltraMsgWebhookPayload) {
  const explicitId = payload.data?.id?.trim();

  if (explicitId) {
    return explicitId;
  }

  return [
    payload.instanceId ?? "unknown-instance",
    payload.data?.from ?? "unknown-sender",
    payload.data?.time ?? "unknown-time",
    getMessageType(payload),
    getIncomingText(payload),
  ].join(":");
}

function hasProcessedMessage(messageId: string) {
  cleanupSafetyState();
  return getSafeModeState().processedMessageIds.has(messageId);
}

function markMessageProcessed(messageId: string) {
  cleanupSafetyState();
  getSafeModeState().processedMessageIds.set(messageId, Date.now());
}

function isRateLimited(sender: string) {
  cleanupSafetyState();
  const state = getSafeModeState();
  const senderTimestamps = state.hourlyReplyTimestampsBySender.get(sender) ?? [];

  return (
    state.hourlyReplyTimestamps.length >= SAFE_MODE_REPLY_LIMIT_PER_HOUR ||
    senderTimestamps.length >= SAFE_MODE_REPLY_LIMIT_PER_HOUR
  );
}

function recordSafeModeReply(sender: string) {
  if (!isWhatsAppSafeMode()) {
    return;
  }

  cleanupSafetyState();
  const state = getSafeModeState();
  const now = Date.now();
  const senderTimestamps = state.hourlyReplyTimestampsBySender.get(sender) ?? [];

  state.hourlyReplyTimestamps.push(now);
  senderTimestamps.push(now);
  state.hourlyReplyTimestampsBySender.set(sender, senderTimestamps);
}

function getSafeModeDelayMs() {
  const range = SAFE_MODE_MAX_REPLY_DELAY_MS - SAFE_MODE_MIN_REPLY_DELAY_MS;
  return SAFE_MODE_MIN_REPLY_DELAY_MS + Math.floor(Math.random() * (range + 1));
}

async function waitBeforeSafeReply(sender: string, inboundMessageId: string) {
  if (!isWhatsAppSafeMode()) {
    return;
  }

  const delayMs = getSafeModeDelayMs();

  console.log("[ultramsg] waiting before reply", {
    from: sender,
    inboundMessageId,
    delayMs,
  });

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

async function parseWebhookPayload(request: Request): Promise<UltraMsgWebhookPayload> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await request.json()) as UltraMsgWebhookPayload;
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    const rawData = form.get("data");

    if (typeof rawData === "string") {
      try {
        return JSON.parse(rawData) as UltraMsgWebhookPayload;
      } catch {
        return {
          event_type: typeof form.get("event_type") === "string" ? String(form.get("event_type")) : undefined,
          instanceId: typeof form.get("instanceId") === "string" ? String(form.get("instanceId")) : undefined,
          data: {
            from: typeof form.get("from") === "string" ? String(form.get("from")) : undefined,
            to: typeof form.get("to") === "string" ? String(form.get("to")) : undefined,
            body: typeof form.get("body") === "string" ? String(form.get("body")) : undefined,
            caption:
              typeof form.get("caption") === "string" ? String(form.get("caption")) : undefined,
            type: typeof form.get("type") === "string" ? String(form.get("type")) : undefined,
            mimetype:
              typeof form.get("mimetype") === "string"
                ? String(form.get("mimetype"))
                : undefined,
            filename:
              typeof form.get("filename") === "string" ? String(form.get("filename")) : undefined,
            fromMe: String(form.get("fromMe") ?? "").toLowerCase() === "true",
          },
        };
      }
    }
  }

  const rawText = await request.text();

  if (!rawText) {
    return {};
  }

  try {
    return JSON.parse(rawText) as UltraMsgWebhookPayload;
  } catch {
    return {};
  }
}

function extractPhoneNumber(chatId?: string) {
  if (!chatId) {
    return null;
  }

  const normalizedChatId = chatId.trim().toLowerCase();

  if (!normalizedChatId || normalizedChatId.includes("@g.us")) {
    return null;
  }

  const digits = normalizedChatId.replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

function buildSessionId(phoneNumber: string) {
  return `ultramsg:${phoneNumber}`;
}

function getMessageType(payload: UltraMsgWebhookPayload) {
  return payload.data?.type?.trim().toLowerCase() || "chat";
}

function isAudioMessageType(type: string) {
  return type === "audio" || type === "ptt" || type === "voice";
}

function isPaymentProofMediaType(type: string) {
  return type === "image" || type === "document";
}

function shouldIgnoreMessage(payload: UltraMsgWebhookPayload) {
  const body = payload.data?.body?.trim();
  const caption = payload.data?.caption?.trim();
  const type = getMessageType(payload);

  if (payload.data?.fromMe) {
    return true;
  }

  if (type !== "chat" && !SUPPORTED_MEDIA_TYPES.has(type)) {
    return true;
  }

  if (type === "chat" && !body && !caption) {
    return true;
  }

  return false;
}

function isResetCommand(message: string) {
  const normalized = normalizeText(message).toLowerCase();
  return ["reset", "reiniciar", "restart", "nuevo chat", "nuevo pedido"].includes(normalized);
}

function getIncomingText(payload: UltraMsgWebhookPayload) {
  return payload.data?.caption?.trim() || payload.data?.body?.trim() || "";
}

function looksLikeMediaPayload(value: string) {
  const trimmed = value.trim();

  return (
    /^https?:\/\//i.test(trimmed) ||
    /^data:(audio|image|application)\//i.test(trimmed) ||
    (/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length > 200)
  );
}

function collectMediaCandidates(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || value === undefined) {
    return [];
  }

  if (typeof value === "string") {
    return looksLikeMediaPayload(value) ? [value.trim()] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectMediaCandidates(item, depth + 1));
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const preferredKeys = [
      "media",
      "mediaUrl",
      "media_url",
      "downloadUrl",
      "download_url",
      "url",
      "file",
      "audio",
      "body",
    ];
    const preferred = preferredKeys.flatMap((key) =>
      collectMediaCandidates(objectValue[key], depth + 1),
    );

    if (preferred.length) {
      return preferred;
    }

    return Object.values(objectValue).flatMap((item) => collectMediaCandidates(item, depth + 1));
  }

  return [];
}

function extractMediaSource(payload: UltraMsgWebhookPayload) {
  return collectMediaCandidates(payload.data)[0] ?? null;
}

function getMimeType(payload: UltraMsgWebhookPayload, fallback = "application/octet-stream") {
  return payload.data?.mimetype ?? payload.data?.mimeType ?? fallback;
}

function inferFilename(mediaSource: string, mimeType: string, fallback: string) {
  try {
    if (/^https?:\/\//i.test(mediaSource)) {
      const url = new URL(mediaSource);
      const pathnameName = url.pathname.split("/").pop();

      if (pathnameName) {
        return pathnameName;
      }
    }
  } catch {
    // Usar fallback si la URL no se puede interpretar.
  }

  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) {
    return `${fallback}.mp3`;
  }

  if (mimeType.includes("ogg") || mimeType.includes("opus")) {
    return `${fallback}.ogg`;
  }

  if (mimeType.includes("wav")) {
    return `${fallback}.wav`;
  }

  return fallback;
}

async function downloadMedia(
  mediaSource: string,
  payload: UltraMsgWebhookPayload,
  fallbackFilename: string,
): Promise<DownloadedMedia> {
  if (/^data:/i.test(mediaSource)) {
    const match = mediaSource.match(/^data:([^;]+);base64,(.+)$/i);

    if (!match) {
      throw new Error("Formato data URI invalido.");
    }

    const mimeType = match[1];
    const bytes = Buffer.from(match[2], "base64");

    return {
      bytes,
      mimeType,
      filename: inferFilename(mediaSource, mimeType, fallbackFilename),
    };
  }

  if (/^https?:\/\//i.test(mediaSource)) {
    const response = await fetch(mediaSource);

    if (!response.ok) {
      throw new Error(`No se pudo descargar el medio (${response.status}).`);
    }

    const mimeType = response.headers.get("content-type") ?? getMimeType(payload);
    const bytes = Buffer.from(await response.arrayBuffer());

    return {
      bytes,
      mimeType,
      filename:
        payload.data?.filename ??
        inferFilename(mediaSource, mimeType, fallbackFilename),
    };
  }

  const mimeType = getMimeType(payload);

  return {
    bytes: Buffer.from(mediaSource, "base64"),
    mimeType,
    filename:
      payload.data?.filename ??
      inferFilename(mediaSource, mimeType, fallbackFilename),
  };
}

function shouldReplyWithAudio() {
  return process.env.WHATSAPP_AUDIO_REPLIES?.trim().toLowerCase() !== "false";
}

function shouldAlsoSendTextWithAudio() {
  if (isWhatsAppSafeMode()) {
    return false;
  }

  return process.env.WHATSAPP_SEND_TEXT_WITH_AUDIO?.trim().toLowerCase() === "true";
}

async function sendAssistantReply(input: {
  recipient: string;
  reply: string;
  inboundMessageId: string;
}) {
  await waitBeforeSafeReply(input.recipient, input.inboundMessageId);

  if (shouldReplyWithAudio() && isElevenLabsConfigured()) {
    try {
      const speech = await generateElevenLabsSpeech(input.reply);

      if (speech) {
        await sendAudioMessage({
          audioBase64: speech.audioBase64,
          caption: input.reply,
          mimeType: speech.mimeType,
          segment: null,
          scheduledAt: new Date(),
          mode: "MANUAL",
          to: input.recipient,
          endpoint: "audio",
          inboundReply: true,
          inboundMessageId: input.inboundMessageId,
        });

        if (shouldAlsoSendTextWithAudio()) {
          await sendMessage({
            message: input.reply,
            segment: null,
            scheduledAt: new Date(),
            mode: "MANUAL",
            to: input.recipient,
            inboundReply: true,
            inboundMessageId: input.inboundMessageId,
          });
        }

        return { audio: true, text: shouldAlsoSendTextWithAudio() };
      }
    } catch (error) {
      console.warn("[ultramsg] error", {
        reason: "audio_reply_failed",
        error,
      });
    }
  }

  await sendMessage({
    message: input.reply,
    segment: null,
    scheduledAt: new Date(),
    mode: "MANUAL",
    to: input.recipient,
    inboundReply: true,
    inboundMessageId: input.inboundMessageId,
  });

  return { audio: false, text: true };
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "ultramsg-ecommerce-webhook",
  });
}

export async function POST(request: Request) {
  try {
    const payload = await parseWebhookPayload(request);
    const inboundMessageId = getInboundMessageId(payload);

    console.log("[ultramsg] webhook received", {
      eventType: payload.event_type ?? null,
      instanceId: payload.instanceId ?? null,
      messageId: inboundMessageId,
      type: getMessageType(payload),
    });

    if (isWhatsAppSafeMode()) {
      console.log("[ultramsg] safe mode active");
    }

    if (payload.event_type && payload.event_type !== "message_received") {
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "unsupported_event",
      });
    }

    if (shouldIgnoreMessage(payload)) {
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "unsupported_message",
      });
    }

    const recipient = extractPhoneNumber(payload.data?.from);

    if (!recipient) {
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "invalid_sender",
      });
    }

    const sessionId = buildSessionId(recipient);
    const messageType = getMessageType(payload);
    const incomingText = getIncomingText(payload);

    console.log("[ultramsg] inbound message from:", recipient);

    if (isWhatsAppSafeMode()) {
      if (hasProcessedMessage(inboundMessageId)) {
        console.warn("[ultramsg] skipped duplicate", {
          from: recipient,
          inboundMessageId,
        });

        return NextResponse.json({
          ok: true,
          ignored: true,
          reason: "duplicate",
        });
      }

      if (isRateLimited(recipient)) {
        console.warn("[ultramsg] rate limit reached", {
          from: recipient,
          inboundMessageId,
          limit: SAFE_MODE_REPLY_LIMIT_PER_HOUR,
        });

        return NextResponse.json({
          ok: true,
          ignored: true,
          reason: "rate_limit",
        });
      }

      markMessageProcessed(inboundMessageId);
    }

    if (incomingText && isResetCommand(incomingText)) {
      resetEcommerceConversation(sessionId);

      const sent = await sendAssistantReply({
        inboundMessageId,
        recipient,
        reply: "Pedido reiniciado. Enviame el producto que quieres comprar y te ayudo de nuevo.",
      });
      recordSafeModeReply(recipient);

      return NextResponse.json({
        ok: true,
        sent: true,
        to: recipient,
        reset: true,
        delivery: sent,
      });
    }

    if (isPaymentProofMediaType(messageType)) {
      console.log("[ecommerce] processing order", {
        from: recipient,
        inboundMessageId,
        event: "payment_proof_media",
      });

      const result = await registerEcommercePaymentProof(sessionId);
      const sent = await sendAssistantReply({
        inboundMessageId,
        recipient,
        reply: result.reply,
      });
      recordSafeModeReply(recipient);

      return NextResponse.json({
        ok: true,
        sent: true,
        to: recipient,
        mediaType: messageType,
        delivery: sent,
      });
    }

    let textForAssistant = incomingText;
    let transcription: string | null = null;

    if (isAudioMessageType(messageType)) {
      console.log("[whatsapp] audio received", {
        from: recipient,
        inboundMessageId,
        type: messageType,
      });

      const mediaSource = extractMediaSource(payload);

      if (!mediaSource) {
        const sent = await sendAssistantReply({
          inboundMessageId,
          recipient,
          reply:
            "No pude descargar la nota de voz. Activa Webhook Download Media en UltraMsg o enviame el pedido escrito.",
        });
        recordSafeModeReply(recipient);

        return NextResponse.json({
          ok: true,
          sent: true,
          to: recipient,
          reason: "missing_media_source",
          delivery: sent,
        });
      }

      const media = await downloadMedia(mediaSource, payload, "nota-voz");
      console.log("[transcription] started", {
        from: recipient,
        inboundMessageId,
        mimeType: media.mimeType,
        filename: media.filename,
      });

      transcription = await transcribeOpenAIAudio({
        audio: media.bytes,
        filename: media.filename,
        mimeType: media.mimeType,
        language: getAudioTranscriptionLanguage(),
      });

      if (!transcription) {
        const sent = await sendAssistantReply({
          inboundMessageId,
          recipient,
          reply:
            "Puedo responder notas de voz, pero falta configurar OPENAI_API_KEY para transcribirlas. Enviame el pedido escrito por ahora.",
        });
        recordSafeModeReply(recipient);

        return NextResponse.json({
          ok: true,
          sent: true,
          to: recipient,
          reason: "openai_not_configured",
          delivery: sent,
        });
      }

      console.log("[transcription] result:", transcription);
      textForAssistant = transcription;
    }

    console.log("[ecommerce] processing order", {
      from: recipient,
      inboundMessageId,
      inputType: messageType,
    });

    const result = await chatWithEcommerceAssistant(sessionId, textForAssistant);
    const sent = await sendAssistantReply({
      inboundMessageId,
      recipient,
      reply: result.reply,
    });
    recordSafeModeReply(recipient);

    return NextResponse.json({
      ok: true,
      sent: true,
      to: recipient,
      transcription,
      usedOpenAI: result.usedOpenAI,
      delivery: sent,
    });
  } catch (error) {
    console.error("[ultramsg] error", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Error procesando el webhook de UltraMsg.",
      },
      { status: 500 },
    );
  }
}
