"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, Edit3, Phone, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelCard } from "@/components/ui/panel-card";
import { Textarea } from "@/components/ui/textarea";
import { formatCompactNumber, formatDate } from "@/lib/format";
import type { SegmentSummary } from "@/lib/types";

type SegmentsManagerProps = {
  segments: SegmentSummary[];
};

type SegmentFormState = {
  name: string;
  description: string;
  estimatedUsers: string;
  recipientPhones: string;
};

const initialForm: SegmentFormState = {
  name: "",
  description: "",
  estimatedUsers: "0",
  recipientPhones: "",
};

export function SegmentsManager({ segments }: SegmentsManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SegmentFormState>(initialForm);
  const [quickSegmentId, setQuickSegmentId] = useState(() => segments[0]?.id ?? "");
  const [quickPhones, setQuickPhones] = useState("");

  const storedNumberEntries = segments.flatMap((segment) =>
    segment.recipientPhones.map((phone) => ({
      phone,
      segmentId: segment.id,
      segmentName: segment.name,
    })),
  );
  const uniqueStoredPhones = Array.from(new Set(storedNumberEntries.map((entry) => entry.phone)));
  const segmentsWithPhones = segments.filter((segment) => segment.recipientPhones.length > 0).length;

  async function request(url: string, options?: RequestInit) {
    const response = await fetch(url, options);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error ?? "No se pudo procesar la solicitud.");
    }

    return payload.data;
  }

  function resetForm() {
    setEditingId(null);
    setForm(initialForm);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      const url = editingId ? `/api/segments/${editingId}` : "/api/segments";
      const method = editingId ? "PATCH" : "POST";
      await request(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...form,
          description: form.description || null,
          estimatedUsers: Number(form.estimatedUsers),
          recipientPhones: form.recipientPhones,
        }),
      });

      toast.success(editingId ? "Segmento actualizado." : "Segmento creado.");
      resetForm();
      startTransition(() => router.refresh());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar.");
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Deseas eliminar este segmento?")) return;

    try {
      await request(`/api/segments/${id}`, { method: "DELETE" });
      toast.success("Segmento eliminado.");
      if (editingId === id) resetForm();
      startTransition(() => router.refresh());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar.");
    }
  }

  function startEditing(segment: SegmentSummary) {
    setEditingId(segment.id);
    setForm({
      name: segment.name,
      description: segment.description ?? "",
      estimatedUsers: String(segment.estimatedUsers),
      recipientPhones: segment.recipientPhones.join("\n"),
    });
  }

  async function handleQuickImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const segment = segments.find((item) => item.id === quickSegmentId);

    if (!segment) {
      toast.error("Selecciona un segmento para guardar los numeros.");
      return;
    }

    if (!quickPhones.trim()) {
      toast.error("Pega al menos un numero de WhatsApp.");
      return;
    }

    try {
      await request(`/api/segments/${segment.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: segment.name,
          description: segment.description,
          estimatedUsers: segment.estimatedUsers,
          recipientPhones: `${segment.recipientPhones.join("\n")}\n${quickPhones}`,
        }),
      });

      toast.success("Numeros agregados al segmento.");
      setQuickPhones("");
      startTransition(() => router.refresh());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron agregar los numeros.");
    }
  }

  async function copyNumbers(numbers: string[]) {
    try {
      await navigator.clipboard.writeText(numbers.join("\n"));
      toast.success("Numeros copiados.");
    } catch {
      toast.error("No se pudieron copiar los numeros.");
    }
  }

  return (
    <div className="space-y-6">
      <section className="panel-card rounded-[34px] px-7 py-8">
        <Badge tone="info">Segmentacion ciudadana</Badge>
        <h1 className="mt-4 text-4xl text-foreground">
          Define coberturas, zonas y audiencias del municipio
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-8 text-muted">
          Usa segmentos por cobertura institucional, frentes de atencion o comunidades
          especificas para asociar comunicados, guardar numeros de WhatsApp y presentar envios
          con alcance localizado.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <PanelCard className="space-y-2">
          <p className="text-sm text-muted">Segmentos configurados</p>
          <p className="text-3xl font-semibold text-foreground">{segments.length}</p>
        </PanelCard>
        <PanelCard className="space-y-2">
          <p className="text-sm text-muted">Numeros guardados</p>
          <p className="text-3xl font-semibold text-foreground">
            {formatCompactNumber(storedNumberEntries.length)}
          </p>
          <p className="text-sm text-muted">Incluye repetidos si un numero esta en varios segmentos.</p>
        </PanelCard>
        <PanelCard className="space-y-2">
          <p className="text-sm text-muted">Numeros unicos</p>
          <p className="text-3xl font-semibold text-foreground">
            {formatCompactNumber(uniqueStoredPhones.length)}
          </p>
          <p className="text-sm text-muted">{segmentsWithPhones} segmento(s) ya tienen base cargada.</p>
        </PanelCard>
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <PanelCard className="space-y-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-muted">
              {editingId ? "Editar segmento" : "Nuevo segmento"}
            </p>
            <h2 className="mt-2 text-2xl text-foreground">
              {editingId ? "Ajusta el territorio seleccionado" : "Agrega una nueva audiencia"}
            </h2>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-foreground">Nombre</span>
              <Input
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Ej. Cultura y bibliotecas"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-semibold text-foreground">Descripcion</span>
              <Textarea
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
                className="min-h-28"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-semibold text-foreground">Usuarios estimados</span>
              <Input
                type="number"
                min="0"
                value={form.estimatedUsers}
                onChange={(event) =>
                  setForm((current) => ({ ...current, estimatedUsers: event.target.value }))
                }
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-semibold text-foreground">
                Numeros de WhatsApp del segmento
              </span>
              <Textarea
                value={form.recipientPhones}
                onChange={(event) =>
                  setForm((current) => ({ ...current, recipientPhones: event.target.value }))
                }
                className="min-h-28"
                placeholder={"+57XXXXXXXXXX\n+57XXXXXXXXXX"}
              />
              <p className="text-xs text-muted">
                Puedes pegar varios numeros separados por linea, coma o punto y coma.
              </p>
            </label>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={isPending}>
                {editingId ? "Actualizar segmento" : "Crear segmento"}
              </Button>
              {editingId ? (
                <Button variant="ghost" onClick={resetForm}>
                  Cancelar
                </Button>
              ) : null}
            </div>
          </form>
        </PanelCard>

        <PanelCard className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-muted">
                Mapa de audiencias
              </p>
              <h2 className="mt-2 text-2xl text-foreground">Segmentos configurados</h2>
            </div>
            <Badge tone="info">{segments.length} segmentos</Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {segments.map((segment) => (
              <article key={segment.id} className="rounded-[28px] border border-border bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-lg font-semibold text-foreground">{segment.name}</p>
                  <Badge tone="success">
                    {formatCompactNumber(segment.estimatedUsers)} usuarios
                  </Badge>
                </div>
                <p className="mt-3 text-sm leading-7 text-muted">
                  {segment.description ?? "Sin descripcion adicional."}
                </p>
                <div className="mt-4 text-sm text-muted">
                  <p>{segment.activeAnnouncements} comunicado(s) asociados</p>
                  <p className="mt-1">
                    {segment.recipientCount} numero(s) de WhatsApp asociado(s)
                  </p>
                  <p className="mt-1">Creado el {formatDate(segment.createdAt)}</p>
                </div>
                <div className="mt-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">Numeros guardados</p>
                    {segment.recipientPhones.length ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
                        onClick={() => void copyNumbers(segment.recipientPhones)}
                      >
                        <Copy className="size-3.5" />
                        Copiar
                      </button>
                    ) : null}
                  </div>
                  {segment.recipientPhones.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {segment.recipientPhones.slice(0, 6).map((phone) => (
                        <Badge key={phone} tone="default">
                          {phone}
                        </Badge>
                      ))}
                      {segment.recipientPhones.length > 6 ? (
                        <Badge tone="info">+{segment.recipientPhones.length - 6} mas</Badge>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted">
                      Este segmento todavia no tiene numeros cargados.
                    </p>
                  )}
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Button variant="secondary" className="gap-2" onClick={() => startEditing(segment)}>
                    <Edit3 className="size-4" />
                    Editar
                  </Button>
                  <Button variant="danger" className="gap-2" onClick={() => handleDelete(segment.id)}>
                    <Trash2 className="size-4" />
                    Eliminar
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </PanelCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <PanelCard className="space-y-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-muted">
              Carga rapida
            </p>
            <h2 className="mt-2 text-2xl text-foreground">Agregar numeros sin editar todo el segmento</h2>
          </div>

          <form className="space-y-4" onSubmit={handleQuickImport}>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-foreground">Segmento destino</span>
              <select
                value={quickSegmentId}
                onChange={(event) => setQuickSegmentId(event.target.value)}
                className="h-11 w-full rounded-2xl border border-border bg-white px-4 text-sm text-foreground outline-none transition focus:border-primary"
              >
                {segments.map((segment) => (
                  <option key={segment.id} value={segment.id}>
                    {segment.name} ({segment.recipientCount} numeros)
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-semibold text-foreground">Numeros de WhatsApp</span>
              <Textarea
                value={quickPhones}
                onChange={(event) => setQuickPhones(event.target.value)}
                className="min-h-40"
                placeholder={"+57XXXXXXXXXX\n+57XXXXXXXXXX\n+57XXXXXXXXXX"}
              />
              <p className="text-xs text-muted">
                Al guardar, el sistema normaliza, elimina duplicados y deja esos numeros listos
                para envios manuales, programados y masivos por segmento.
              </p>
            </label>

            <Button type="submit" disabled={isPending || !segments.length}>
              Guardar numeros
            </Button>
          </form>
        </PanelCard>

        <PanelCard className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-muted">
                Base de WhatsApp
              </p>
              <h2 className="mt-2 text-2xl text-foreground">Numeros registrados en administracion</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="info">{uniqueStoredPhones.length} unicos</Badge>
              <Badge tone="success">{storedNumberEntries.length} registros</Badge>
            </div>
          </div>

          {storedNumberEntries.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {storedNumberEntries.map((entry) => (
                <article
                  key={`${entry.segmentId}-${entry.phone}`}
                  className="rounded-[24px] border border-border bg-white px-4 py-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-full bg-surface text-primary">
                      <Phone className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">{entry.phone}</p>
                      <p className="text-sm text-muted">{entry.segmentName}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-[24px] border border-dashed border-border bg-surface px-5 py-6 text-sm text-muted">
              Todavia no hay numeros guardados. Puedes empezar pegando una base en la carga
              rapida o dentro de cada segmento.
            </div>
          )}

          <div className="rounded-[24px] bg-surface px-5 py-5 text-sm leading-7 text-muted">
            <div className="inline-flex items-center gap-2 font-semibold text-foreground">
              <UsersRound className="size-4 text-primary" />
              Como se usa esta base
            </div>
            <p className="mt-2">
              Los envios masivos del panel toman los numeros guardados en cada segmento. El bot de
              IA por WhatsApp sigue entrando por el webhook de UltraMsg y responde al remitente
              real que escriba al numero conectado.
            </p>
          </div>
        </PanelCard>
      </div>
    </div>
  );
}
