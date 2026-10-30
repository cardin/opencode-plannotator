import { execFile } from "node:child_process";
import { isSupportedTuiVersion, MIN_TUI_VERSION, tuiTooOldMessage } from "./tui-guard";

export interface TuiProbe {
  available: boolean;
  version?: string;
  reason?: string;
}

const PROBE_TTL_MS = 30_000;
let probeCache: (TuiProbe & { at: number; binary: string }) | undefined;

export function tuiBinary(env: Record<string, string | undefined> = process.env): string {
  return env.PLANNOTATOR_TUI_BIN?.trim() || "plannotator-tui";
}

export async function probeTui(binary: string = tuiBinary()): Promise<TuiProbe> {
  if (probeCache?.binary === binary && Date.now() - probeCache.at < PROBE_TTL_MS) return probeCache;
  const result = await new Promise<{ code: number; stdout: string }>((resolve) => {
    execFile(binary, ["--version"], { timeout: 5000, windowsHide: true }, (error, stdout) => {
      resolve({ code: error ? 1 : 0, stdout: String(stdout ?? "") });
    });
  });
  const version = result.stdout.trim();
  const probe: TuiProbe = result.code !== 0 || !version
    ? {
        available: false,
        reason: `Could not run \`${binary} --version\`. Install plannotator-tui ${MIN_TUI_VERSION}+ ` +
          "with `brew install plannotator/tap/plannotator-tui` or `cargo install plannotator-tui`.",
      }
    : isSupportedTuiVersion(version)
      ? { available: true, version }
      : { available: false, version, reason: tuiTooOldMessage(version) };
  probeCache = { ...probe, at: Date.now(), binary };
  return probeCache;
}
