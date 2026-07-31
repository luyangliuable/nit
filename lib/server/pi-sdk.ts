// The pi SDK ships as an ESM only package. Our server modules are loaded as CJS
// by tsx and by Next's server runtime, where a static import compiles to a
// require() that the package's exports map rejects. Loading it through a native
// dynamic import (built with the Function constructor so neither esbuild nor
// webpack rewrites it to require) uses Node's ESM loader in every context.

const nativeImport = new Function("m", "return import(m)") as (
  m: string,
) => Promise<any>;

let cached: Promise<any> | null = null;

export function loadPiSdk(): Promise<any> {
  if (!cached) cached = nativeImport("@mariozechner/pi-coding-agent");
  return cached;
}
