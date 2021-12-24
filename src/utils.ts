import path from "upath"
import fs from "fs"
import resolveFrom from "resolve-from"

export function arraify<T>(target: T | T[]): T[] {
  return Array.isArray(target) ? target : [target]
}

export function lookupFile(
  dir: string,
  names: string[],
  opts: { resolveOnly?: boolean; type?: "file" | "dir" } = {},
): string | undefined {
  const { resolveOnly = true, type = "file" } = opts
  for (const name of names) {
    const fullPath = path.join(dir, name)
    if (fs.existsSync(fullPath)) {
      const isDir = fs.statSync(fullPath).isDirectory()
      if (type === "file" && isDir) {
        continue
      }
      if (type === "dir" && !isDir) {
        continue
      }
      return resolveOnly ? fullPath : fs.readFileSync(fullPath, "utf-8")
    }
  }
  const parentDir = path.dirname(dir)
  if (parentDir !== dir) {
    return lookupFile(parentDir, names, opts)
  }
}

// URL and files in public directory are external resources
// So we don't bundle them
export const isExternalResource = (link: string, publicDir: string) => {
  if (/^(\/\/|https?:\/\/)/.test(link)) return true

  if (fs.existsSync(path.join(publicDir, link))) {
    return true
  }

  return false
}

export const localImport = async <T>(
  id: string,
  dir = path.resolve(),
): Promise<T> => {
  const resolved = resolveFrom.silent(dir, id)

  return resolved && (await import(id))
}

type Truthy<T> = T extends false | "" | 0 | null | undefined ? never : T // from lodash

export function truthy<T>(value: T): value is Truthy<T> {
  return Boolean(value)
}
