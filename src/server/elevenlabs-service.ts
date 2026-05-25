const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY?.trim() ?? "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID?.trim() ?? "";
const ELEVENLABS_MODEL_ID =
  process.env.ELEVENLABS_MODEL_ID?.trim() || "eleven_multilingual_v2";
const ELEVENLABS_OUTPUT_FORMAT =
  process.env.ELEVENLABS_OUTPUT_FORMAT?.trim() || "mp3_44100_128";
const ELEVENLABS_LANGUAGE_CODE =
  process.env.ELEVENLABS_LANGUAGE_CODE?.trim() || "es";

function getAudioMimeType(outputFormat: string) {
  if (outputFormat.startsWith("mp3_")) {
    return "audio/mpeg";
  }

  if (outputFormat.startsWith("ulaw_")) {
    return "audio/basic";
  }

  if (outputFormat.startsWith("pcm_")) {
    return "audio/pcm";
  }

  return "audio/mpeg";
}

export function isElevenLabsConfigured() {
  return Boolean(ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID);
}

export function getElevenLabsConfigStatus() {
  return {
    configured: isElevenLabsConfigured(),
    missingApiKey: !ELEVENLABS_API_KEY,
    missingVoiceId: !ELEVENLABS_VOICE_ID,
    modelId: ELEVENLABS_MODEL_ID,
    outputFormat: ELEVENLABS_OUTPUT_FORMAT,
    languageCode: ELEVENLABS_LANGUAGE_CODE,
  };
}

export async function generateElevenLabsSpeech(text: string) {
  if (!isElevenLabsConfigured()) {
    return null;
  }

  const url = new URL(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
      ELEVENLABS_VOICE_ID,
    )}`,
  );
  url.searchParams.set("output_format", ELEVENLABS_OUTPUT_FORMAT);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL_ID,
      language_code: ELEVENLABS_LANGUAGE_CODE,
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.8,
        style: 0.2,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const rawText = await response.text();
    throw new Error(`ElevenLabs no pudo generar audio (${response.status}): ${rawText}`);
  }

  const audio = Buffer.from(await response.arrayBuffer());

  return {
    audioBase64: audio.toString("base64"),
    mimeType: getAudioMimeType(ELEVENLABS_OUTPUT_FORMAT),
    outputFormat: ELEVENLABS_OUTPUT_FORMAT,
  };
}

export async function generateSpeechWithElevenLabs(text: string) {
  const speech = await generateElevenLabsSpeech(text);

  if (!speech) {
    return null;
  }

  return Buffer.from(speech.audioBase64, "base64");
}
