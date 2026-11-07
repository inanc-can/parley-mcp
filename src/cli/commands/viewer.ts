export interface ViewerDeps {
  write: (line: string) => void;
}

/**
 * `parley-mcp viewer`: the local web viewer is built in M6 (PLAN section 8).
 * Until then this command exists so the CLI surface is complete and reports
 * where the feature is coming.
 */
export function runViewer(deps: ViewerDeps): void {
  deps.write("The Parley viewer arrives in M6; it is not available yet.");
}
