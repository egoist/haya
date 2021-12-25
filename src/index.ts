import http from "http"
import path from "upath"
import fs from "fs"
import esbuild, { formatMessages, BuildResult } from "esbuild"
import { createApp } from "h3"
import posthtml from "posthtml"
import sirv from "sirv"
import chokidar from "chokidar"
import { WebSocketServer } from "ws"
import hashsum from "hash-sum"
import vuePlugin from "esbuild-plugin-vue"
import { copyFolderSync, outputFileSync } from "./fs"
import {
  loadCompilerOptions,
  loadConfig,
  loadEnv,
  ResolvedConfig,
  UserConfig,
} from "./config"
import { isExternalResource, lookupFile, truthy } from "./utils"
import { cssPlugin } from "./esbuild/css-plugin"
import { rawPlugin } from "./esbuild/raw-plugin"
import { workerPlugin } from "./esbuild/worker-plugin"
import { wrapEsbuildPlugins } from "./plugin"
import { progressPlugin } from "./esbuild/progress-plugin"

const slash = (input: string) => input.replace(/\\/g, "/")

const handleError = async (error: any) => {
  process.exitCode = 1
  if (error.errors || error.warnings) {
    if (error.errors) {
      const messages = await formatMessages(error.errors, {
        kind: "error",
        color: true,
      })
      messages.forEach((msg) => console.error(msg))
    }
    if (error.warnings) {
      const messages = await formatMessages(error.warnings, {
        kind: "warning",
        color: true,
      })
      messages.forEach((msg) => console.error(msg))
    }
  } else {
    console.error(error.stack)
  }
}

const transformAssetUrls: Record<string, string[]> = {
  script: ["src"],
  link: ["href"],
  img: ["src"],
  image: ["xlink:href", "href"],
  source: ["src"],
  video: ["src", "poster"],
  use: ["xlink:href", "href"],
  audio: ["src"],
}

type BuildEndArgs = { html: string }

const _build = async ({
  options,
  config,
  buildEnd,
  reload,
}: {
  options: NormalizedOptions
  config: ResolvedConfig
  buildEnd: (args: BuildEndArgs) => void
  reload?: () => void
}) => {
  const htmlPath = path.join(options.dir, "index.html")

  const publicPath = options.base
  let result: Awaited<ReturnType<typeof startBuild>> | undefined

  const handleBuildEnd = () => {
    if (!result) return
    const { metafile, extraCssFiles } = result

    const entryOutputMap: Record<string, string> = {}

    Object.keys(result.entry).forEach((entryName) => {
      const entryFile = result!.entry[entryName]
      for (const outputName in metafile.outputs) {
        const inputs = metafile.outputs[outputName].inputs

        if (path.relative(options.dir, entryFile) in inputs) {
          entryOutputMap[entryName] =
            publicPath +
            path.relative(options.outDir, path.join(options.dir, outputName))
          return
        }
      }
      throw new Error(`can't find output file for ${entryName}`)
    })

    const html = result.htmlTemplate
      .replace(/HAYA_REPLACE\[([^\]]+)\]/g, (_, entryName) => {
        return entryOutputMap[entryName]
      })

      .replace(
        "</head>",
        `${[...extraCssFiles]
          .map((file) => {
            return `<link href="${
              publicPath + path.relative(options.outDir, file)
            }" rel="stylesheet">`
          })
          .join("\n")}</head>`,
      )
      .replace(
        "</body>",
        options.dev
          ? `<script>
    let ws = new WebSocket('ws://localhost:3000')
    // Send a welcome message
    // when the web socket is connected
    ws.addEventListener('open', function (event) {
      console.log('Web Socket connected!')
    })
    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'reload') location.reload()
    })
    </script></body>`
          : `</body>`,
      )
    buildEnd({ html })
  }

  const startBuild = async () => {
    const extraCssFiles: Set<string> = new Set()
    const watchFiles: Set<string> = new Set()
    const watchDirs: Set<string> = new Set()

    if (!fs.existsSync(htmlPath)) {
      throw new Error(`${htmlPath} does not exist`)
    }

    const entry: Record<string, string> = {}
    let htmlTemplate = await fs.promises.readFile(htmlPath, "utf8")
    htmlTemplate = await posthtml([
      (tree) => {
        tree.walk((node) => {
          if (!node.attrs) return node

          for (const tag in transformAssetUrls) {
            if (node.tag !== tag) continue
            const attrs = transformAssetUrls[tag]
            for (const attr of attrs) {
              const link = node.attrs[attr]
              if (link) {
                const source = link.split("?")[0]
                const isExternal = isExternalResource(source, options.publicDir)
                if (!isExternal) {
                  if (tag === "script" && node.attrs.type !== "module") {
                    throw new Error(`type="module" is required on <script> tag`)
                  }
                  let [, name] = /\/([^\.\/]+)\.\w+$/.exec(source) || []
                  name = name.replace(/[^\w]/g, "-")
                  const hash = hashsum(source)
                  const entryName = `${name}-${hash}`
                  entry[entryName] =
                    path.join(options.dir, source) +
                    (/\.(css|postcss)$/.test(source) ? "?css" : "")
                  node.attrs[attr] = `HAYA_REPLACE[${entryName}]`
                }
              }
            }
          }

          return node
        })
      },
    ])
      .process(htmlTemplate, {})
      .then((res) => res.html)

    const compilerOptions = loadCompilerOptions(options.dir)
    let jsxShimPath: string | undefined
    if (compilerOptions.data.jsx?.includes("react")) {
      const names: string[] = [
        compilerOptions.data.jsxFactory,
        compilerOptions.data.jsxFragmentFactory,
      ].filter((v) => v && !v.includes("."))
      const jsxImportSource = compilerOptions.data.jsxImportSource || "react"
      const jsxShim =
        names.length > 0
          ? `import {${names.join(
              ",",
            )}} from '${jsxImportSource}';export {${names.join(",")}}`
          : `import * as React from 'react';export { React }`
      const nodeModulesDir = lookupFile(options.dir, ["node_modules"], {
        type: "dir",
      })
      if (!nodeModulesDir) {
        throw new Error("node_modules directory not found")
      }
      jsxShimPath = path.join(nodeModulesDir, ".haya/jsx-shim.js")
      outputFileSync(jsxShimPath, jsxShim)
    }

    const esbuildPlugin = wrapEsbuildPlugins(
      [
        progressPlugin(),
        cssPlugin(),
        rawPlugin(),
        workerPlugin(),
        vuePlugin(),
        ...config.__esbuildPlugins,
      ],
      {
        extraCssFiles,
        watchFiles,
        watchDirs,
      },
    )

    const result = await esbuild.build({
      absWorkingDir: options.dir,
      entryPoints: entry,
      bundle: true,
      outdir: options.outDir,
      platform: "browser",
      mainFields: ["module", "browser", "main"],
      inject: [jsxShimPath].filter(truthy),
      metafile: true,
      format: "esm",
      splitting: true,
      sourcemap: options.dev,
      sourcesContent: options.dev,
      incremental: options.dev,
      publicPath,
      entryNames: options.dev ? "[name]" : "[name]-[hash]",
      assetNames: "[name]-[hash]",
      chunkNames: "[name]-[hash]",
      minify: !options.dev,
      legalComments: "none",
      logLevel: "silent",
      loader: {
        ".aac": "file",
        ".eot": "file",
        ".flac": "file",
        ".gif": "file",
        ".jpeg": "file",
        ".jpg": "file",
        ".mp3": "file",
        ".mp4": "file",
        ".ogg": "file",
        ".otf": "file",
        ".png": "file",
        ".svg": "file",
        ".ttf": "file",
        ".wav": "file",
        ".webm": "file",
        ".webp": "file",
        ".woff": "file",
        ".woff2": "file",
      },
      define: {
        ...Object.keys(options.env).reduce((res, key) => {
          return {
            ...res,
            [`process.env.${key}`]: JSON.stringify(options.env[key]),
            [`import.meta.env.${key}`]: JSON.stringify(options.env[key]),
          }
        }, {}),
        __DEV__: options.dev ? "true" : "false",
      },
      plugins: [esbuildPlugin],
    })
    const handle = (result: BuildResult) => {
      return {
        entry,
        htmlTemplate,
        metafile: result.metafile!,
        extraCssFiles,
        watchDirs,
        watchFiles,
        deps: Object.keys(result.metafile!.inputs).map((v) =>
          v.replace(/\?.*$/, ""),
        ),
        rebuild: async () => {
          const rebuildResult = await result.rebuild!()
          return handle(rebuildResult)
        },
        dispose: () => result.rebuild!.dispose(),
      }
    }

    return handle(result)
  }

  try {
    result = await startBuild()
    handleBuildEnd()
  } catch (error) {
    await handleError(error)
  }

  if (options.dev) {
    chokidar
      .watch(options.dir, {
        ignored: ["**/node_modules/**", "**/{dist,.git}/**"],
        ignorePermissionErrors: true,
        ignoreInitial: true,
      })
      .on("all", async (event, filepath) => {
        if (!result) return
        filepath = slash(filepath)

        const rebuildLog = () =>
          console.log(
            `Rebuilding due to ${event} on ${path.relative(
              process.cwd(),
              filepath,
            )}`,
          )

        if (htmlPath === filepath) {
          rebuildLog()
          result.dispose()
          try {
            result = await startBuild()
            handleBuildEnd()
          } catch (error) {
            handleError(error)
          }
        } else if (filepath.startsWith(options.publicDir)) {
          if (
            reload &&
            /\.(css|js|jpg|jpeg|png|webp|gif|svg|ttf|otf)$/.test(filepath)
          ) {
            reload()
          }
        } else if (
          result.deps.some((dep) => path.join(options.dir, dep) === filepath) ||
          result.watchFiles.has(filepath) ||
          [...result.watchDirs].some((dir) => filepath.startsWith(dir))
        ) {
          try {
            rebuildLog()
            result = await result.rebuild()
            handleBuildEnd()
          } catch (error) {
            await handleError(error)
          }
        }
      })
  }
}

export type Options = { dir?: string; dev?: boolean }

export type NormalizedOptions = {
  dir: string
  dev: boolean
  outDir: string
  publicDir: string
  env: Record<string, string | boolean>
  base: string
}

const normalizeOptions = (options: Options): NormalizedOptions => {
  const dir = path.resolve(options.dir || ".")
  const outDir = path.join(dir, "dist")
  const publicDir = path.join(dir, "public")
  const dev = !!options.dev
  const mode = dev ? "development" : "production"
  const base = "/"
  const env: Record<string, string | boolean> = {
    ...loadEnv(mode, dir),
    NODE_ENV: dev ? "development" : "production",
    PROD: !dev,
    DEV: dev,
    BASE_URL: base,
  }
  return {
    dir,
    dev,
    outDir,
    publicDir,
    env,
    base,
  }
}

export const createServer = async (
  _options: Options,
  inlineConfig?: UserConfig,
) => {
  const options = normalizeOptions(_options)
  const config = await loadConfig(options.dir, inlineConfig)

  const app = createApp()
  const wss = new WebSocketServer({ noServer: true })
  const reload = () => {
    wss.clients.forEach((client) => {
      client.send(JSON.stringify({ type: "reload" }))
    })
  }

  // Serve output files
  app.use((req, res, next) => {
    if (req.method !== "GET") {
      return next()
    }

    sirv(options.outDir, { dev: true })(req, res, next)
  })

  // Serve public folder
  app.use((req, res, next) => {
    if (req.method !== "GET") {
      return next()
    }

    sirv(options.publicDir, { dev: true })(req, res, next)
  })

  let html = ""

  await _build({
    options,
    config: config.data,
    buildEnd(result) {
      html = result.html
      reload()
    },
    reload,
  })

  // Serve index.html
  app.use(async (req, res, next) => {
    if (req.method !== "GET") return next()

    res.setHeader("Content-Type", "text/html")
    res.end(html)
  })

  const server = http.createServer(app)

  server.on("upgrade", function upgrade(request, socket, head) {
    wss.handleUpgrade(request, socket, head, function done(ws) {
      wss.emit("connection", ws, request)
    })
  })

  server.listen(config.data.server.port)

  return {
    app,
    config,
    close() {
      server.close()
    },
  }
}

export const build = async (_options: Options) => {
  const options = normalizeOptions(_options)
  const config = await loadConfig(options.dir)

  await _build({
    options,
    config: config.data,
    buildEnd({ html }) {
      outputFileSync(path.join(options.outDir, "index.html"), html)
    },
  })

  // Copy public dir to output dir
  copyFolderSync(options.publicDir, options.outDir)
}

export const preview = async (
  _options: Options,
  inlineConfig: UserConfig = {},
) => {
  const options = normalizeOptions(_options)
  const config = await loadConfig(options.dir, inlineConfig)
  const app = createApp()

  app.use((req, res, next) => {
    sirv(options.outDir, { dev: false })(req, res, next)
  })

  const server = http.createServer(app)
  server.listen(config.data.server.port)

  return {
    config,
    close() {
      server.close()
    },
  }
}

export const defineConfig = (config: UserConfig) => config
