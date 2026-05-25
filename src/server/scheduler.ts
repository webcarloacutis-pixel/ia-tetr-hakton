import "dotenv/config";

import { getErrorMessage } from "@/lib/errors";
import { processScheduledAnnouncements } from "@/server/panel-service";

const POLL_INTERVAL_MS = 15_000;
let lastLoggedError = "";
let lastLoggedAt = 0;

if (process.env.ECOMMERCE_ONLY === "true" || !process.env.DATABASE_URL) {
  console.log("[scheduler] Disabled in ecommerce-only mode.");
  process.exit(0);
}

function normalizeSchedulerError(error: unknown) {
  const message = getErrorMessage(error);

  if (message.includes("Authentication failed against database server")) {
    return "No fue posible autenticar contra PostgreSQL. Revisa DATABASE_URL/DIRECT_URL o conecta Supabase antes de arrancar el scheduler.";
  }

  if (message.includes("Can't reach database server")) {
    return "No fue posible conectar con PostgreSQL. Verifica que la base este encendida o que la URL de Supabase sea correcta.";
  }

  return message;
}

async function tick() {
  try {
    const result = await processScheduledAnnouncements();
    lastLoggedError = "";
    lastLoggedAt = 0;

    if (result.processedCount > 0) {
      console.log(
        `[scheduler] ${result.processedCount} comunicado(s) enviados en este ciclo.`,
      );
    } else {
      console.log("[scheduler] Sin comunicados pendientes para enviar.");
    }
  } catch (error) {
    const message = normalizeSchedulerError(error);
    const now = Date.now();
    const shouldLogAgain = message !== lastLoggedError || now - lastLoggedAt > 60_000;

    if (shouldLogAgain) {
      console.error(`[scheduler] ${message}`);
      lastLoggedError = message;
      lastLoggedAt = now;
    }
  }
}

console.log(
  `[scheduler] Worker iniciado. Revisando comunicados cada ${POLL_INTERVAL_MS / 1000} segundos.`,
);

void tick();
const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);

function shutdown(signal: string) {
  console.log(`[scheduler] Deteniendo worker por senal ${signal}.`);
  clearInterval(interval);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
