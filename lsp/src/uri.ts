import { fileURLToPath } from "node:url";

export function filePathFromUri(uri: string): string | null {
  try {
    if (!uri.startsWith("file:")) return null;
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}
