/** Utilidades comunes de respuesta para las herramientas. */
import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { CHARACTER_LIMIT } from "./config.js";

export const responseFormat = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("'markdown' (legible, por defecto) o 'json' (datos completos estructurados)");

export type Fmt = "markdown" | "json";

/** Respuesta de texto simple. */
export function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: clip(t) }] };
}

/** Respuesta JSON con structuredContent (si cabe en el límite). */
export function json(data: unknown): CallToolResult {
  const s = JSON.stringify(data, null, 2);
  if (s.length > CHARACTER_LIMIT) {
    return {
      content: [
        {
          type: "text",
          text:
            s.slice(0, CHARACTER_LIMIT) +
            `\n…(respuesta recortada: ${s.length} caracteres). Usa filtros/paginación (limit, offset) o pide datos más concretos.`,
        },
      ],
    };
  }
  const obj = data !== null && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : { result: data };
  return { content: [{ type: "text", text: s }], structuredContent: obj };
}

/** Elige formato. */
export function out(fmt: Fmt, data: unknown, markdown: () => string): CallToolResult {
  return fmt === "json" ? json(data) : text(markdown());
}

export function clip(t: string): string {
  return t.length > CHARACTER_LIMIT
    ? t.slice(0, CHARACTER_LIMIT) + "\n…(recortado; pide menos datos o usa response_format='json' con paginación)"
    : t;
}

/** Pagina un array con limit/offset y devuelve metadatos. */
export function paginate<T>(items: T[], limit: number, offset: number) {
  const page = items.slice(offset, offset + limit);
  const next = offset + page.length;
  const has_more = items.length > next;
  return { total: items.length, count: page.length, offset, items: page, has_more, ...(has_more ? { next_offset: next } : {}) };
}

export function msgs(messages: string[]): string {
  return messages.length ? `\nMensajes del servidor: ${messages.join(" | ")}` : "";
}

export const pagination = {
  limit: z.number().int().min(1).max(500).default(100).describe("Máximo de elementos a devolver"),
  offset: z.number().int().min(0).default(0).describe("Elementos a saltar (paginación)"),
};

export const RACE_STATUS: Record<number, string> = { 0: "READY (lista)", 1: "RACING (en carrera)", 2: "DONE (terminada, laps sin guardar)", 3: "STAGING (preparando salida)" };

export const WIN_CONDITION: Record<number, string> = {
  0: "Ninguna",
  1: "Más progreso (más vueltas en menor tiempo)",
  2: "Primero en X vueltas",
  3: "Vuelta más rápida",
  4: "Consecutivas más rápidas",
  5: "Más vueltas",
  6: "Más vueltas + overtime",
};

export const START_BEHAVIOR: Record<number, string> = { 0: "Holeshot", 1: "First lap", 2: "Staggered start" };
