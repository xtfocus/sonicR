/**
 * Parse `--key=value`, `--key value` and bare `--key` flags into a map
 * (empty value when bare). Positional tokens are ignored.
 */
export function parseFlagArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(argv[i]!);
    if (!m) continue;
    const [, key, value] = m;
    if (value != null) {
      args.set(key, value);
    } else {
      const next = argv[i + 1];
      if (next != null && !next.startsWith('--')) {
        args.set(key, next);
        i++;
      } else {
        args.set(key, '');
      }
    }
  }
  return args;
}
