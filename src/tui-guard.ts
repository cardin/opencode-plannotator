/** The decision-file contract arrived in plannotator-tui 0.9.9. */
export const MIN_TUI_VERSION = "0.9.9";

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
}

export function parseVersion(text: string): ParsedVersion | null {
  const match = /(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(text.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? "",
  };
}

export function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

export function isSupportedTuiVersion(text: string, minimum = MIN_TUI_VERSION): boolean {
  const parsed = parseVersion(text);
  const floor = parseVersion(minimum);
  return parsed !== null && floor !== null && compareVersions(parsed, floor) >= 0;
}

export function tuiTooOldMessage(found: string | undefined, minimum = MIN_TUI_VERSION): string {
  const actual = found ? `plannotator-tui ${found}` : "plannotator-tui (version unknown)";
  return (
    `${actual} is too old for terminal review: ${minimum} or newer is required ` +
    `(it added --gate, --json and --result-file).\n\n` +
    `Upgrade with: brew upgrade plannotator-tui   (or: cargo install plannotator-tui)`
  );
}

export function isHeadless(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (truthy(env.PLANNOTATOR_REMOTE)) return true;
  const forwarded = Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
  if (truthy(env.CI)) return true;
  if (platform === "linux" && !forwarded) return true;
  if ((env.SSH_CONNECTION || env.SSH_TTY) && !forwarded) return true;
  return false;
}

function truthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  return !["", "0", "false", "no", "off"].includes(value.trim().toLowerCase());
}
