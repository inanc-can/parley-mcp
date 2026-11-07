function escapeRegex(text: string): string {
  return text.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

export function globToRegExp(glob: string): RegExp {
  let pattern = "^";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === "*") {
      const next = glob[i + 1];
      if (next === "*") {
        const after = glob[i + 2];
        if (after === "/") {
          pattern += "(?:.*/)?";
          i += 3;
          continue;
        }
        pattern += ".*";
        i += 2;
        continue;
      }
      pattern += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      pattern += "[^/]";
      i += 1;
      continue;
    }
    if (ch !== undefined) {
      pattern += escapeRegex(ch);
    }
    i += 1;
  }
  pattern += "$";
  return new RegExp(pattern);
}

export function globMatch(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path);
}
