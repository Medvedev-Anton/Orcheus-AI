/**
 * Join project root and relative path for IPC readFile (Windows-safe).
 */

export function joinProjectPath(projectRoot, relativePath) {
  const root = String(projectRoot || '').replace(/[/\\]+$/, '');
  const rel = String(relativePath || '').replace(/^[/\\]+/, '');
  if (!root) return rel;
  const sep = root.includes('\\') ? '\\' : '/';
  return `${root}${sep}${rel}`;
}
