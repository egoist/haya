import http from "http"
import path from "upath"
import fs from "fs"
import esbuild, { formatMessages, BuildResult } from "esbuild"
import { createApp } from "h3"
import posthtml from "posthtml"
import sirv from "sirv"
import chokidar from "chokidar"
import { WebSocketServer } from "ws"
import timeSpan, { TimeEndFunction } from "time-span"
import hashsum from "hash-sum"
import { copyFolderSync, outputFileSync, removeFolderSync } from "./fs"
import { loadCompilerOptions, loadConfig, loadEnv, UserConfig } from "./config"
import { isExternalResource, lookupFile, truthy } from "./utils"
import { cssPlugin } from "./esbuild/css-plugin"
import { rawPlugin } from "./esbuild/raw-plugin"

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

type BuildEndArgs = { html: string }

const _build = async ({
  options,
  buildEnd,
  reload,
}: {
  options: NormalizedOptions
  buildEnd: (args: BuildEndArgs) => void
  reload?: () => void
}) => {
  const htmlPath = path.join(options.dir, "index.html")

  const publicPath = "/"
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

    if (!fs.existsSync(htmlPath)) {
      throw new Error(`${htmlPath} does not exist`)
    }

    const entry: Record<string, string> = {}
    let htmlTemplate = await fs.promises.readFile(htmlPath, "utf8")
    htmlTemplate = await posthtml([
      (tree) => {
        tree.walk((node) => {
          if (
            node.tag === "script" &&
            typeof node.attrs === "object" &&
            node.attrs.type === "module" &&
            node.attrs.src
          ) {
            const source = node.attrs.src.split("?")[0]
            const isExternal = isExternalResource(source, options.publicDir)
            if (!isExternal) {
              let [, name] = /\/([^\.\/]+)\.\w+$/.exec(source) || []
              name = name.replace(/[^\w]/g, "-")
              const hash = hashsum(source)
              const entryName = `${name}-${hash}`
              entry[entryName] = path.join(options.dir, source)
              node.attrs.src = `HAYA_REPLACE[${entryName}]`
            }
          }
          if (
            node.tag === "link" &&
            typeof node.attrs === "object" &&
            node.attrs.href
          ) {
            const source = node.attrs.href.split("?")[0]
            const isExternal = isExternalResource(source, options.publicDir)
            if (!isExternal) {
              let [, name] = /\/([^\.\/]+)\.\w+$/.exec(source) || []
              name = name.replace(/[^\w]/g, "-")
              const hash = hashsum(source)
              const entryName = `${name}-${hash}`
              entry[entryName] =
                path.join(options.dir, source) +
                (/\.(css|postcss)$/.test(source) ? "?css" : "")
              node.attrs.href = `HAYA_REPLACE[${entryName}]`
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
      entryNames: options.dir ? "[name]" : "[name]-[hash]",
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
          }
        }, {}),
        "process.env.NODE_ENV": options.dev ? '"development"' : '"production"',
        __DEV__: options.dev ? "true" : "false",
      },
      plugins: [
        {
          name: "progress",
          setup(build) {
            let end: TimeEndFunction | undefined
            build.onStart(async () => {
              end = timeSpan()
              extraCssFiles.clear()
              removeFolderSync(options.outDir)
            })
            build.onEnd(() => {
              if (end) {
                console.log(`⚡️ Built in ${end.rounded()}ms`)
              }
            })
          },
        },
        cssPlugin(extraCssFiles),
        rawPlugin(),
      ],
    })

    const handle = (result: BuildResult) => {
      return {
        entry,
        htmlTemplate,
        metafile: result.metafile!,
        extraCssFiles,
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
        ignored: ["**/node_modules/**", "**/dist/**"],
        ignorePermissionErrors: true,
        ignoreInitial: true,
      })
      .on("all", async (event, filepath) => {
        if (!result) return
        filepath = slash(filepath)
        if (htmlPath === filepath) {
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
          result.deps.some((dep) => path.join(options.dir, dep) === filepath)
        ) {
          try {
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
  env: Record<string, string>
}

const normalizeOptions = (options: Options): NormalizedOptions => {
  const dir = path.resolve(options.dir || ".")
  const outDir = path.join(dir, "dist")
  const publicDir = path.join(dir, "public")
  const dev = !!options.dev
  const env = loadEnv(dev ? "development" : "production", dir)
  return {
    dir,
    dev,
    outDir,
    publicDir,
    env,
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

  await _build({
    options,
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
