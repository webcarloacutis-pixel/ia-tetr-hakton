"use client";

import { Mic, Play, RefreshCw, Send, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AudioTestResponse = {
  ok: boolean;
  transcription?: string;
  reply?: string;
  audioBase64?: string | null;
  audioMimeType?: string | null;
  openAIConfigured?: boolean;
  elevenLabsConfigured?: boolean;
  elevenLabsError?: string | null;
  error?: string;
};

type RecordingState = "idle" | "recording" | "sending" | "ready" | "error";

function getSupportedMimeType() {
  const options = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];

  return options.find((option) => MediaRecorder.isTypeSupported(option)) ?? "";
}

function createSessionId() {
  return `audio-test-${crypto.randomUUID()}`;
}

function speakWithBrowserVoice(text: string) {
  if (!("speechSynthesis" in window)) {
    return;
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-CO";
  utterance.rate = 1;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

export function EcommerceAudioTest() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcription, setTranscription] = useState("");
  const [reply, setReply] = useState("");
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [replyAudioUrl, setReplyAudioUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [settings, setSettings] = useState({
    openAIConfigured: false,
    elevenLabsConfigured: false,
  });

  const stateLabel = useMemo(() => {
    if (recordingState === "recording") {
      return "Grabando";
    }

    if (recordingState === "sending") {
      return "Procesando";
    }

    if (recordingState === "ready") {
      return "Respuesta lista";
    }

    if (recordingState === "error") {
      return "Error";
    }

    return "Listo";
  }, [recordingState]);

  useEffect(() => {
    setSessionId(createSessionId());

    void fetch("/api/ecommerce/audio-test")
      .then((response) => response.json() as Promise<AudioTestResponse>)
      .then((payload) => {
        setSettings({
          openAIConfigured: Boolean(payload.openAIConfigured),
          elevenLabsConfigured: Boolean(payload.elevenLabsConfigured),
        });
      })
      .catch(() => {
        setSettings({
          openAIConfigured: false,
          elevenLabsConfigured: false,
        });
      });
  }, []);

  useEffect(() => {
    return () => {
      if (recordedAudioUrl) {
        URL.revokeObjectURL(recordedAudioUrl);
      }

      if (replyAudioUrl) {
        URL.revokeObjectURL(replyAudioUrl);
      }
    };
  }, [recordedAudioUrl, replyAudioUrl]);

  async function startRecording() {
    setError(null);
    setTranscription("");
    setReply("");

    if (replyAudioUrl) {
      URL.revokeObjectURL(replyAudioUrl);
      setReplyAudioUrl(null);
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        void submitRecording(mimeType || recorder.mimeType || "audio/webm");
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingState("recording");
    } catch {
      setRecordingState("error");
      setError("No pude abrir el microfono. Revisa el permiso del navegador.");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      setRecordingState("sending");
    }
  }

  async function submitRecording(mimeType: string) {
    const blob = new Blob(chunksRef.current, { type: mimeType });

    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl);
    }

    setRecordedAudioUrl(URL.createObjectURL(blob));

    const form = new FormData();
    form.set("sessionId", sessionId || createSessionId());
    form.set("audio", blob, "audio-test.webm");

    try {
      const response = await fetch("/api/ecommerce/audio-test", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as AudioTestResponse;

      setSettings({
        openAIConfigured: Boolean(payload.openAIConfigured),
        elevenLabsConfigured: Boolean(payload.elevenLabsConfigured),
      });

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "No se pudo procesar el audio.");
      }

      setTranscription(payload.transcription ?? "");
      setReply(payload.reply ?? "");
      if (payload.elevenLabsError) {
        setError(payload.elevenLabsError);
      }

      if (payload.audioBase64 && payload.audioMimeType) {
        const audioBlob = await fetch(
          `data:${payload.audioMimeType};base64,${payload.audioBase64}`,
        ).then((audioResponse) => audioResponse.blob());
        const audioUrl = URL.createObjectURL(audioBlob);

        if (replyAudioUrl) {
          URL.revokeObjectURL(replyAudioUrl);
        }

        setReplyAudioUrl(audioUrl);
        setTimeout(() => {
          audioElementRef.current?.play().catch(() => {
            speakWithBrowserVoice(payload.reply ?? "");
          });
        }, 50);
      } else if (payload.reply) {
        speakWithBrowserVoice(payload.reply);
      }

      setRecordingState("ready");
    } catch (caughtError) {
      setRecordingState("error");
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo procesar.");
    }
  }

  function resetTest() {
    setSessionId(createSessionId());
    setError(null);
    setTranscription("");
    setReply("");
    setRecordingState("idle");
    window.speechSynthesis?.cancel();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <section className="w-full max-w-4xl overflow-hidden rounded-[28px] border border-border bg-white shadow-2xl shadow-primary/10">
        <div className="grid gap-0 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="flex min-h-[520px] flex-col justify-between bg-[#132c48] p-6 text-white sm:p-8">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    recordingState === "recording"
                      ? "bg-danger"
                      : recordingState === "sending"
                        ? "bg-warning"
                        : "bg-success",
                  )}
                />
                {stateLabel}
              </div>
              <h1 className="mt-8 text-4xl leading-tight sm:text-5xl">
                Prueba de voz ecommerce
              </h1>
              <div className="mt-6 grid gap-3 text-sm text-white/80">
                <div className="flex items-center justify-between rounded-xl bg-white/10 px-4 py-3">
                  <span>OpenAI</span>
                  <span className="font-semibold">
                    {settings.openAIConfigured ? "Configurado" : "Pendiente"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-white/10 px-4 py-3">
                  <span>ElevenLabs</span>
                  <span className="font-semibold">
                    {settings.elevenLabsConfigured ? "Configurado" : "Voz navegador"}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              {recordingState === "recording" ? (
                <Button
                  className="h-16 gap-3 rounded-full bg-danger text-base hover:bg-[#9d3f3f]"
                  onClick={stopRecording}
                >
                  <Square className="size-5" />
                  Detener
                </Button>
              ) : (
                <Button
                  className="h-16 gap-3 rounded-full bg-accent text-base hover:bg-[#09656b]"
                  disabled={recordingState === "sending"}
                  onClick={() => void startRecording()}
                >
                  <Mic className="size-5" />
                  Grabar
                </Button>
              )}
              <Button
                className="h-12 gap-2 rounded-full bg-white/10 text-white hover:bg-white/15"
                variant="ghost"
                onClick={resetTest}
              >
                <RefreshCw className="size-4" />
                Nuevo pedido
              </Button>
            </div>
          </div>

          <div className="grid min-h-[520px] gap-5 bg-[#f7fafc] p-6 sm:p-8">
            <div className="rounded-2xl border border-border bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl text-foreground">Tu audio</h2>
                {recordedAudioUrl ? (
                  <audio className="h-9 max-w-[180px]" controls src={recordedAudioUrl} />
                ) : null}
              </div>
              <p className="mt-4 min-h-20 rounded-xl bg-surface p-4 text-sm leading-6 text-muted">
                {transcription || "La transcripcion aparecera aqui."}
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl text-foreground">Respuesta</h2>
                {replyAudioUrl ? (
                  <Button
                    className="size-10 rounded-full p-0"
                    aria-label="Reproducir respuesta"
                    onClick={() => audioElementRef.current?.play()}
                  >
                    <Play className="size-4" />
                  </Button>
                ) : null}
              </div>
              <p className="mt-4 min-h-40 whitespace-pre-wrap rounded-xl bg-[#eef7f6] p-4 text-sm leading-6 text-foreground">
                {reply || "La respuesta del bot aparecera aqui."}
              </p>
              {replyAudioUrl ? (
                <audio ref={audioElementRef} className="mt-4 w-full" controls src={replyAudioUrl} />
              ) : null}
            </div>

            {error ? (
              <div className="flex items-start gap-3 rounded-2xl border border-danger/25 bg-[#fff0f0] p-4 text-sm text-danger">
                <Send className="mt-0.5 size-4 shrink-0" />
                <p>{error}</p>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
