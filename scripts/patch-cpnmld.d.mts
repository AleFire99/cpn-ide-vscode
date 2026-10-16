export const ENGINE_ENTRY: string;
export const NEEDLE: Buffer;
export const LOOPBACK: Buffer;
export const TARGETS: Record<string, { original: string; patched: string }>;
export function patchLoopback(buf: Buffer): Buffer;
export function patchChecked(name: string, buf: Buffer, t?: { original: string; patched: string }): Buffer | null;
export function patchBackendJar(jar: string): boolean;
