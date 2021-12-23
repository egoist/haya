import path from "upath"
import fs from "fs"

export function arraify<T>(target: T | T[]): T[] {
  return Array.isArray(target) ? target : [target]
}

export function lookupFile(
  dir: string,
  formats: string[],
  pathOnly = false,
): string | undefined {
  for (const format of formats) {
    const fullPath = path.join(dir, format)
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return pathOnly ? fullPath : fs.readFileSync(fullPath, "utf-8")
    }
  }
  const parentDir = path.dirname(dir)
  if (parentDir !== dir) {
    return lookupFile(parentDir, formats, pathOnly)
  }
}

export const isExternalLink = (input: string) => {
  return /^(\/\/|https?:\/\/)/.test(input)
}
