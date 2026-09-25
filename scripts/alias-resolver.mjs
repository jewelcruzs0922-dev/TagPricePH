/**
 * Resolves the `@/…` import alias that Next.js takes from tsconfig `paths`,
 * so verification scripts can load application modules in plain Node.
 *
 * Node strips TypeScript types itself, but it does not read tsconfig, so a
 * module that says `import { x } from "@/lib/pricing"` has nowhere to go.
 * Registering this hook (see `registerHooks` in the verify scripts) maps the
 * alias onto the repo root and tries the extensions Node would not guess —
 * `.ts`, `.tsx`, `/index.ts`.
 *
 * Deliberately narrow: it handles one alias and nothing else, and it never
 * rewrites a specifier it does not recognise, so a genuine miss still fails
 * loudly instead of silently resolving to the wrong file. Synchronous by
 * requirement — `module.registerHooks` runs in-thread and cannot await.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO_ROOT = new URL("../", import.meta.url);
const EXTENSIONS = [".ts", ".tsx", "/index.ts", ".js"];

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const base = new URL(specifier.slice(2), REPO_ROOT);
    for (const extension of EXTENSIONS) {
      const candidate = new URL(base.href + extension);
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true };
      }
    }
    throw new Error(
      `alias-resolver: no file matches "@/…${specifier.slice(2)}" under ${REPO_ROOT.pathname}`,
    );
  }
  return nextResolve(specifier, context);
}
