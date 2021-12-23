import fs from "fs"
import dotenv from "dotenv"
import dotenvExpand from "dotenv-expand"
import { bundleRequire } from "bundle-require"
import { DeepRequired } from "ts-essentials"
import { arraify, lookupFile } from "./utils"

// Stolen from Vite
export function loadEnv(
  mode: string,
  envDir: string,
  prefixes: string | string[] = "VEI_",
): Record<string, string> {
  if (mode === "local") {
    throw new Error(
      `"local" cannot be used as a mode name because it conflicts with ` +
        `the .local postfix for .env files.`,
    )
  }
  prefixes = arraify(prefixes)
  const env: Record<string, string> = {}
  const envFiles = [
    /** mode local file */ `.env.${mode}.local`,
    /** mode file */ `.env.${mode}`,
    /** local file */ `.env.local`,
    /** default file */ `.env`,
  ]

  // check if there are actual env variables starting with VEI_*
  // these are typically provided inline and should be prioritized
  for (const key in process.env) {
    if (
      prefixes.some((prefix) => key.startsWith(prefix)) &&
      env[key] === undefined
    ) {
      env[key] = process.env[key] as string
    }
  }

  for (const file of envFiles) {
    const path = lookupFile(envDir, [file], true)
    if (path) {
      const parsed = dotenv.parse(fs.readFileSync(path), {
        debug: !!process.env.DEBUG || undefined,
      })

      // let environment variables use each other
      dotenvExpand({
        parsed,
        // prevent process.env mutation
        ignoreProcessEnv: true,
      } as any)

      // only keys that start with prefix are exposed to client
      for (const [key, value] of Object.entries(parsed)) {
        if (
          prefixes.some((prefix) => key.startsWith(prefix)) &&
          env[key] === undefined
        ) {
          env[key] = value
        } else if (key === "NODE_ENV") {
          // NODE_ENV override in .env file
          process.env.VEI_USER_NODE_ENV = value
        }
      }
    }
  }
  return env
}

export type UserConfig = {
  server?: {
    port?: number
  }
}

export type ResolvedConfig = DeepRequired<UserConfig>

export const loadConfig = async (
  dir: string,
  inlineConfig: UserConfig = {},
): Promise<{
  data: ResolvedConfig
  path?: string
  dependencies: string[]
}> => {
  const configPath = lookupFile(
    dir,
    ["vei.config.ts", "vei.config.mjs", "vei.config.js", "vei.config.cjs"],
    true,
  )
  let userConfig: UserConfig = {}
  let dependencies: string[] = []
  if (configPath) {
    const { mod, dependencies: _deps } = await bundleRequire({
      filepath: configPath,
      external: ["vei"],
    })
    userConfig = mod.default || {}
    dependencies = _deps
  }

  return {
    data: {
      ...userConfig,
      ...inlineConfig,
      server: {
        ...userConfig.server,
        ...inlineConfig.server,
        port: inlineConfig.server?.port ?? userConfig.server?.port ?? 3000,
      },
    },
    path: configPath,
    dependencies,
  }
}
