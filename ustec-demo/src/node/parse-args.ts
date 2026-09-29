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

/**
 * Multi-value variant for repeatable flags (`--annotate a --annotate b`):
 * same syntax as {@link parseFlagArgs} but every occurrence is kept.
 */
export function parseFlagArgsAll(argv: string[]): Map<string, string[]> {
  const args = new Map<string, string[]>();
  const push = (key: string, value: string): void => {
    const list = args.get(key) ?? [];
    list.push(value);
    args.set(key, list);
  };
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(argv[i]!);
    if (!m) continue;
    const [, key, value] = m;
    if (value != null) {
      push(key, value);
    } else {
      const next = argv[i + 1];
      if (next != null && !next.startsWith('--')) {
        push(key, next);
        i++;
      } else {
        push(key, '');
      }
    }
  }
  return args;
}
