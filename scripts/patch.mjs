export function replaceExactlyOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (!before || count !== 1) {
    throw new Error(`Patch "${label}" expected exactly one anchor; found ${count}. Review the upstream release before proceeding.`);
  }
  return source.replace(before, () => after);
}

export function patchBundle(source, patch) {
  let result = source;
  for (const change of patch.changes) {
    result = replaceExactlyOnce(result, change.before, change.after, `${patch.file}: ${change.label}`);
  }
  return "/* Modified by the standalone Plannotator terminal-review patch. See PATCH-NOTICE.md. */\n" +
    patch.imports + "\n" + result;
}
