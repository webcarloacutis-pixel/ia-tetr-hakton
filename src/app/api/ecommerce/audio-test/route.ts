import { NextResponse } from "next/server";

import { chatWithEcommerceAssistant } from "@/server/ecommerce-assistant";
import {
  generateElevenLabsSpeech,
  getElevenLabsConfigStatus,
  isElevenLabsConfigured,
} from "@/server/elevenlabs-service";
import { isOpenAIConfigured, transcribeOpenAIAudio } from "@/server/openai-service";

export const runtime = "nodejs";

function getAudioExtension(mimeType: string) {
  if (mimeType.includes("webm")) {
    return "webm";
  }

  if (mimeType.includes("mp4") || mimeType.includes("mpeg")) {
    return "mp4";
  }

  if (mimeType.includes("ogg") || mimeType.includes("opus")) {
    return "ogg";
  }

  if (mimeType.includes("wav")) {
    return "wav";
  }

  return "webm";
}

export async function GET() {
  const elevenLabs = getElevenLabsConfigStatus();

  return NextResponse.json({
    ok: true,
    openAIConfigured: isOpenAIConfigured(),
    elevenLabsConfigured: elevenLabs.configured,
    elevenLabs,
  });
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const audio = form.get("audio");
    const sessionId =
      typeof form.get("sessionId") === "string"
        ? String(form.get("sessionId")).trim()
        : "audio-test";

    if (!(audio instanceof File)) {
      return NextResponse.json(
        {
          ok: false,
          error: "No se recibio audio para procesar.",
        },
        { status: 400 },
      );
    }

    if (!isOpenAIConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          error: "Falta configurar OPENAI_API_KEY para transcribir el audio.",
          openAIConfigured: false,
          elevenLabsConfigured: isElevenLabsConfigured(),
        },
        { status: 400 },
      );
    }

    const bytes = await audio.arrayBuffer();
    const mimeType = audio.type || "audio/webm";
    const transcription = await transcribeOpenAIAudio({
      audio: bytes,
      filename: audio.name || `audio-test.${getAudioExtension(mimeType)}`,
      mimeType,
      language: "es",
    });

    if (!transcription) {
      return NextResponse.json(
        {
          ok: false,
          error: "No se pudo transcribir el audio.",
          openAIConfigured: true,
          elevenLabsConfigured: isElevenLabsConfigured(),
        },
        { status: 502 },
      );
    }

    const result = await chatWithEcommerceAssistant(sessionId || "audio-test", transcription);
    let speech: Awaited<ReturnType<typeof generateElevenLabsSpeech>> = null;
    let elevenLabsError: string | null = null;

    try {
      speech = await generateElevenLabsSpeech(result.reply);
    } catch (error) {
      elevenLabsError =
        error instanceof Error ? error.message : "ElevenLabs request failed";
      console.warn("[audio-test] ElevenLabs no genero audio, se usara fallback", error);
    }

    const elevenLabs = getElevenLabsConfigStatus();

    return NextResponse.json({
      ok: true,
      transcription,
      reply: result.reply,
      usedOpenAI: result.usedOpenAI,
      audioBase64: speech?.audioBase64 ?? null,
      audioMimeType: speech?.mimeType ?? null,
      openAIConfigured: true,
      elevenLabsConfigured: isElevenLabsConfigured(),
      elevenLabs,
      elevenLabsError:
        elevenLabsError ??
        (!elevenLabs.configured
          ? elevenLabs.missingApiKey
            ? "missing ELEVENLABS_API_KEY"
            : "missing ELEVENLABS_VOICE_ID"
          : null),
    });
  } catch (error) {
    console.error("[audio-test] error", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Error procesando la prueba de audio.",
      },
      { status: 500 },
    );
  }
}
