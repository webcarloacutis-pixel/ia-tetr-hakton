type MessageSegment = {
  id: string | null;
  name: string;
  estimatedUsers: number;
  recipientPhones?: string[];
};

type SafeReplyMetadata = {
  inboundReply?: boolean;
  inboundMessageId?: string | null;
};

type SendMessageInput = SafeReplyMetadata & {
  message: string;
  segment: MessageSegment | null;
  scheduledAt: Date;
  mode?: "DEMO" | "MANUAL" | "SCHEDULED";
  to?: string | null;
};

type SendAudioMessageInput = SafeReplyMetadata & {
  audioBase64: string;
  caption?: string;
  mimeType?: string;
  segment: MessageSegment | null;
  scheduledAt: Date;
  mode?: "DEMO" | "MANUAL" | "SCHEDULED";
  to?: string | null;
  endpoint?: "audio" | "voice";
};

const DEFAULT_AUDIENCE = 1250;
const ULTRAMSG_INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID?.trim() ?? "";
const ULTRAMSG_BASE_URL = process.env.ULTRAMSG_BASE_URL?.trim() ?? "";
const ULTRAMSG_TOKEN = process.env.ULTRAMSG_TOKEN?.trim() ?? "";
const WHATSAPP_SAFE_MODE = process.env.WHATSAPP_SAFE_MODE?.trim().toLowerCase() === "true";

function getUltraMsgBaseUrl() {
  if (ULTRAMSG_BASE_URL) {
    return ULTRAMSG_BASE_URL.replace(/\/$/, "");
  }

  if (ULTRAMSG_INSTANCE_ID) {
    return `https://api.ultramsg.com/${ULTRAMSG_INSTANCE_ID}`;
  }

  return "";
}

function validateUltraMsgConfig() {
  const baseUrl = getUltraMsgBaseUrl();

  if (!ULTRAMSG_TOKEN) {
    console.warn("[ultramsg] missing token");
  }

  if (!ULTRAMSG_INSTANCE_ID && !ULTRAMSG_BASE_URL) {
    console.warn("[ultramsg] missing instance id");
  }

  return {
    configured: Boolean(baseUrl && ULTRAMSG_TOKEN),
    baseUrl,
  };
}

function isUltraMsgConfigured() {
  return validateUltraMsgConfig().configured;
}

function assertSafeModeAllowsSend(input: SafeReplyMetadata & { to?: string | null }) {
  if (!WHATSAPP_SAFE_MODE) {
    return true;
  }

  console.log("[ultramsg] safe mode active", {
    inboundReply: Boolean(input.inboundReply),
    inboundMessageId: input.inboundMessageId ?? null,
    to: input.to ?? null,
  });

  if (!input.inboundReply || !input.to) {
    console.warn("[ultramsg] safe mode active: skipped outbound message", {
      reason: "not_inbound_reply",
      inboundMessageId: input.inboundMessageId ?? null,
      to: input.to ?? null,
    });
    return false;
  }

  return true;
}

function normalizeRecipient(value: string) {
  const digits = value.replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  return digits.startsWith("57") ? `+${digits}` : `+57${digits}`;
}

function resolveRecipients(to?: string | null) {
  const rawRecipients = (to?.trim() || "")
    .split(/[,\n;]/)
    .map((value) => normalizeRecipient(value.trim()))
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(rawRecipients));
}

async function sendMessageMock({
  message,
  segment,
  scheduledAt,
  mode,
}: SendMessageInput) {
  const deliveredCount = segment?.recipientPhones?.length || segment?.estimatedUsers || DEFAULT_AUDIENCE;
  const targetName = segment?.name ?? "Cobertura general";
  const preview = message.length > 80 ? `${message.slice(0, 80)}...` : message;

  console.log("[messageService] envio mock ejecutado", {
    mode,
    scheduledAt: scheduledAt.toISOString(),
    segment: targetName,
    deliveredCount,
    preview,
  });

  await new Promise((resolve) => setTimeout(resolve, 300));

  return {
    deliveredCount,
    log: `Enviado a ${new Intl.NumberFormat("es-CO").format(deliveredCount)} usuarios`,
  };
}

async function sendAudioMessageMock({
  audioBase64,
  caption,
  segment,
  scheduledAt,
  mode,
  endpoint,
}: SendAudioMessageInput) {
  const deliveredCount = segment?.recipientPhones?.length || segment?.estimatedUsers || DEFAULT_AUDIENCE;
  const targetName = segment?.name ?? "Cobertura general";

  console.log("[messageService] envio mock de audio ejecutado", {
    mode,
    scheduledAt: scheduledAt.toISOString(),
    segment: targetName,
    endpoint: endpoint ?? "audio",
    audioBytesApprox: Math.round((audioBase64.length * 3) / 4),
    caption,
  });

  await new Promise((resolve) => setTimeout(resolve, 300));

  return {
    deliveredCount,
    log: `Audio enviado a ${new Intl.NumberFormat("es-CO").format(deliveredCount)} usuarios`,
  };
}

function stripDataUriPrefix(value: string) {
  return value.replace(/^data:[^;]+;base64,/i, "").trim();
}

async function sendMessageUltraMsg({
  message,
  segment,
  scheduledAt,
  mode,
  to,
  inboundMessageId,
}: SendMessageInput) {
  const config = validateUltraMsgConfig();
  const targetName = segment?.name ?? "Cobertura general";
  const recipients = resolveRecipients(to || segment?.recipientPhones?.join(",") || null);

  if (!recipients.length) {
    throw new Error("No hay destinatarios configurados para UltraMsg.");
  }

  const responses: unknown[] = [];
  const failures: string[] = [];

  for (const recipient of recipients) {
    const payload = new URLSearchParams({
      token: ULTRAMSG_TOKEN,
      to: recipient,
      body: message,
    });

    console.log("[ultramsg] sending reply", {
      to: recipient,
      inboundMessageId: inboundMessageId ?? null,
      endpoint: "messages/chat",
    });

    const response = await fetch(`${config.baseUrl}/messages/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    });

    const rawText = await response.text();
    let parsedBody: unknown = rawText;

    try {
      parsedBody = JSON.parse(rawText);
    } catch {
      // Mantener texto crudo si UltraMsg no devuelve JSON.
    }

    if (!response.ok) {
      console.error("[ultramsg] error", {
        mode,
        scheduledAt: scheduledAt.toISOString(),
        segment: targetName,
        to: recipient,
        status: response.status,
        body: parsedBody,
      });

      failures.push(`${recipient} (${response.status})`);
      continue;
    }

    responses.push({
      to: recipient,
      body: parsedBody,
    });

    console.log("[ultramsg] reply sent", {
      to: recipient,
      inboundMessageId: inboundMessageId ?? null,
      status: response.status,
    });
  }

  if (!responses.length) {
    throw new Error(
      failures.length
        ? `UltraMsg no pudo enviar a ningun destinatario: ${failures.join(", ")}.`
        : "UltraMsg no pudo enviar el mensaje.",
    );
  }

  return {
    deliveredCount: responses.length,
    log:
      failures.length > 0
        ? `Enviado por UltraMsg a ${responses.length} destinatario(s). Fallaron: ${failures.join(", ")}`
        : `Enviado por UltraMsg a ${recipients.join(", ")}`,
  };
}

async function sendAudioMessageUltraMsg({
  audioBase64,
  caption,
  segment,
  scheduledAt,
  mode,
  to,
  endpoint = "audio",
  inboundMessageId,
}: SendAudioMessageInput) {
  const config = validateUltraMsgConfig();
  const targetName = segment?.name ?? "Cobertura general";
  const recipients = resolveRecipients(to || segment?.recipientPhones?.join(",") || null);

  if (!recipients.length) {
    throw new Error("No hay destinatarios configurados para UltraMsg.");
  }

  const responses: unknown[] = [];
  const failures: string[] = [];
  const cleanAudioBase64 = stripDataUriPrefix(audioBase64);

  for (const recipient of recipients) {
    const payload = new URLSearchParams({
      token: ULTRAMSG_TOKEN,
      to: recipient,
      audio: cleanAudioBase64,
    });

    console.log("[ultramsg] sending reply", {
      to: recipient,
      inboundMessageId: inboundMessageId ?? null,
      endpoint: `messages/${endpoint}`,
      caption,
    });

    const response = await fetch(`${config.baseUrl}/messages/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    });

    const rawText = await response.text();
    let parsedBody: unknown = rawText;

    try {
      parsedBody = JSON.parse(rawText);
    } catch {
      // Mantener texto crudo si UltraMsg no devuelve JSON.
    }

    if (!response.ok) {
      console.error("[ultramsg] error", {
        mode,
        scheduledAt: scheduledAt.toISOString(),
        segment: targetName,
        to: recipient,
        endpoint,
        status: response.status,
        body: parsedBody,
      });

      failures.push(`${recipient} (${response.status})`);
      continue;
    }

    responses.push({
      to: recipient,
      body: parsedBody,
    });

    console.log("[ultramsg] reply sent", {
      to: recipient,
      inboundMessageId: inboundMessageId ?? null,
      endpoint,
      status: response.status,
    });
  }

  if (!responses.length) {
    throw new Error(
      failures.length
        ? `UltraMsg no pudo enviar audio a ningun destinatario: ${failures.join(", ")}.`
        : "UltraMsg no pudo enviar el audio.",
    );
  }

  return {
    deliveredCount: responses.length,
    log:
      failures.length > 0
        ? `Audio enviado por UltraMsg a ${responses.length} destinatario(s). Fallaron: ${failures.join(", ")}`
        : `Audio enviado por UltraMsg a ${recipients.join(", ")}`,
  };
}

export async function sendMessage(input: SendMessageInput) {
  if (input.mode === "DEMO") {
    return sendMessageMock(input);
  }

  if (!assertSafeModeAllowsSend(input)) {
    return {
      deliveredCount: 0,
      log: "Envio omitido por WHATSAPP_SAFE_MODE.",
    };
  }

  if (!isUltraMsgConfigured()) {
    console.warn("[ultramsg] error", {
      reason: "not_configured",
      fallback: "mock",
    });
    return sendMessageMock(input);
  }

  return sendMessageUltraMsg(input);
}

export async function sendAudioMessage(input: SendAudioMessageInput) {
  if (input.mode === "DEMO") {
    return sendAudioMessageMock(input);
  }

  if (!assertSafeModeAllowsSend(input)) {
    return {
      deliveredCount: 0,
      log: "Envio de audio omitido por WHATSAPP_SAFE_MODE.",
    };
  }

  if (!isUltraMsgConfigured()) {
    console.warn("[ultramsg] error", {
      reason: "not_configured",
      fallback: "mock_audio",
    });
    return sendAudioMessageMock(input);
  }

  return sendAudioMessageUltraMsg(input);
}
