import OpenAI from "openai";

const globalForOpenAI = globalThis as unknown as {
  __rionegroOpenAIClient?: OpenAI | null;
};

export function isOpenAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getOpenAIModel() {
  return process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";
}

export function getOpenAITranscriptionModel() {
  return process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "gpt-4o-mini-transcribe";
}

function getClient() {
  if (!isOpenAIConfigured()) {
    return null;
  }

  if (!globalForOpenAI.__rionegroOpenAIClient) {
    globalForOpenAI.__rionegroOpenAIClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  return globalForOpenAI.__rionegroOpenAIClient;
}

export async function generateOpenAIText(input: {
  systemPrompt: string;
  userPrompt: string;
}) {
  const client = getClient();

  if (!client) {
    return null;
  }

  const response = await client.responses.create({
    model: getOpenAIModel(),
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: input.systemPrompt }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: input.userPrompt }],
      },
    ],
  });

  return response.output_text.trim();
}

export async function transcribeOpenAIAudio(input: {
  audio: ArrayBuffer | Uint8Array;
  filename?: string;
  mimeType?: string;
  language?: string;
  prompt?: string;
}) {
  const client = getClient();

  if (!client) {
    return null;
  }

  const bytes = input.audio instanceof Uint8Array ? input.audio : new Uint8Array(input.audio);
  const audioBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(audioBuffer).set(bytes);

  const file = new File([audioBuffer], input.filename ?? "nota-voz.ogg", {
    type: input.mimeType ?? "audio/ogg",
  });

  const response = await client.audio.transcriptions.create({
    file,
    model: getOpenAITranscriptionModel(),
    language: input.language ?? "es",
    prompt:
      input.prompt ??
      "Transcribe una nota de voz de WhatsApp de un cliente de ecommerce en Colombia. Mantén nombres de productos, direcciones, ciudad, precios y comprobantes de pago.",
  });

  return response.text.trim();
}
