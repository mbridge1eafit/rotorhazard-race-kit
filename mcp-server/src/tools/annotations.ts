import type { ToolAnnotations } from "@modelcontextprotocol/server";

/** Solo lectura. */
export const RO: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
/** Escritura no destructiva. */
export const W: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
/** Escritura idempotente (fijar un valor). */
export const W_IDEMPOTENT: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
/** Destructiva: borra o sobrescribe datos, reinicia o apaga. */
export const W_DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
