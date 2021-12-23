import http from "http"
import path from "upath"
import fs from "fs"
import esbuild, { Metafile } from "esbuild"
import { createApp } from "h3"
import posthtml from "posthtml"
import sirv from "sirv"
import chokidar from "chokidar"
import { WebSocketServer } from "ws"
import timeSpan, { TimeEndFunction } from "time-span"
import { copyFolderSync, outputFileSync, removeFolderSync } from "./fs"
import { loadConfig, loadEnv, UserConfig } from "./config"
import { isExternalLink } from "./utils"

const slash = (input: string) => input.replace(/\\/g, "/")

type BuildResult = { html: string }

const _build = async ({
  options,
  buildEnd,
  reload,
}: {
  options: NormalizedOptions
  buildEnd: (result: BuildResult) => void
  reload?: () => void
}) => {
  const htmlPath = path.join(options.dir, "index.html")

  let deps: string[] = []
  let htmlTemplate = ""
  let entry: Record<string, string> = {}
  const publicPath = "/"

  const setHtmlTemplate = async () => {
    if (!fs.existsSync(htmlPath)) {
      throw new Error(`${htmlPath} does not exist`)
    }

    entry = {}
    htmlTemplate = await fs.promises.readFile(htmlPath, "utf8")
    htmlTemplate = await posthtml([
      (tree) => {
        tree.walk((node) => {
          if (
            node.tag === "script" &&
            typeof node.attrs === "object" &&
            node.attrs.type === "module" &&
            node.attrs.src
          ) {
            const isExternal = isExternalLink(node.attrs.src)
            if (!isExternal) {
              const index = Object.keys(entry).length
              const [, name] = /\/([^\.]+)\.\w+$/.exec(node.attrs.src) || []
              entry[`${index}-${name}`] = path.join(options.dir, node.attrs.src)
              node.attrs.src = `__haya_SCRIPT_SRC_${index}__`
            }
          }
          if (
            node.tag === "link" &&
            typeof node.attrs === "object" &&
            node.attrs.rel === "stylesheet" &&
            node.attrs.href
          ) {
            const isExternal = isExternalLink(node.attrs.href)
            if (!isExternal) {
              const index = Object.keys(entry).length
              const [, name] = /\/([^\.]+)\.\w+$/.exec(node.attrs.href) || []
              entry[`${index}-${name}`] =
                path.join(options.dir, node.attrs.href) + "?css"
              node.attrs.href = `__haya_STYLE_HREF_${index}__`
            }
          }
          return node
        })
      },
    ])
      .process(htmlTemplate, {})
      .then((res) => res.html)
  }

  const handleBuildEnd = (metafile: Metafile) => {
    const entryOutputFiles: string[] = Object.values(entry).map((entryFile) => {
      for (const relativePath in metafile.outputs) {
        const file = metafile.outputs[relativePath]
        if (
          file.entryPoint &&
          entryFile === path.join(options.dir, file.entryPoint)
        ) {
          return path.relative(
            options.outDir,
            path.join(options.dir, relativePath),
          )
        }
      }
      throw new Error(`can't find output file for ${entryFile}`)
    })

    deps = Object.keys(metafile.inputs).map((v) => v.replace(/\?.*$/, ""))

    const html = htmlTemplate
      .replace(/__haya_SCRIPT_SRC_(\d+)__/g, (_, index) => {
        return publicPath + entryOutputFiles[index]
      })
      .replace(/__haya_STYLE_HREF_(\d+)__/g, (_, index) => {
        return publicPath + entryOutputFiles[index]
      })
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
    await setHtmlTemplate()
    const result = await esbuild.build({
      absWorkingDir: options.dir,
      entryPoints: entry,
      bundle: true,
      outdir: options.outDir,
      platform: "browser",
      mainFields: ["module", "browser", "main"],
      metafile: true,
      format: "esm",
      splitting: true,
      sourcemap: options.dev,
      sourcesContent: options.dev,
      incremental: options.dev,
      publicPath,
      entryNames: options.dev ? "[name]" : "[name]-[hash]",
      minify: !options.dev,
      legalComments: "none",
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
              removeFolderSync(options.outDir)
            })
            build.onEnd(() => {
              if (end) {
                console.log(`⚡️ Built in ${end.rounded()}ms`)
              }
            })
          },
        },
        {
          name: "css",
          setup(build) {
            build.onLoad({ filter: /\.css$/ }, async (args) => {
              if (args.suffix === "?css") {
                // For link stylesheet in HTML file
                // Just load it as css
                return {
                  loader: "css",
                  contents: await fs.promises.readFile(args.path, "utf8"),
                }
              }
              const result = await esbuild.build({
                format: "esm",
                bundle: true,
                outdir: options.outDir,
                entryPoints: [args.path],
                write: false,
                sourcemap: options.dev && "inline",
                minify: build.initialOptions.minify,
              })
              return {
                contents: result.outputFiles[0].contents,
                loader: "file",
              }
            })
          },
        },
      ],
    })

    return {
      htmlTemplate,
      metafile: result.metafile!,
      rebuild: () => result.rebuild!(),
      dispose: () => result.rebuild!.dispose(),
    }
  }

  let result = await startBuild()
  handleBuildEnd(result.metafile)

  if (options.dev) {
    chokidar
      .watch(options.dir, {
        ignored: ["**/node_modules/**", "**/dist/**"],
        ignorePermissionErrors: true,
        ignoreInitial: true,
      })
      .on("all", async (event, filepath) => {
        filepath = slash(filepath)
        if (htmlPath === filepath) {
          result.dispose()
          result = await startBuild()
          handleBuildEnd(result.metafile)
        } else if (filepath.startsWith(options.publicFolder)) {
          if (
            reload &&
            /\.(css|js|jpg|jpeg|png|webp|gif|svg|ttf|otf)$/.test(filepath)
          ) {
            reload()
          }
        } else if (
          deps.some((dep) => path.join(options.dir, dep) === filepath)
        ) {
          const rebuildResult = await result.rebuild()
          handleBuildEnd(rebuildResult.metafile!)
        }
      })
  }
}

export type Options = { dir?: string; dev?: boolean }

export type NormalizedOptions = {
  dir: string
  dev: boolean
  outDir: string
  publicFolder: string
  env: Record<string, string>
}

const normalizeOptions = (options: Options): NormalizedOptions => {
  const dir = path.resolve(options.dir || ".")
  const outDir = path.join(dir, "dist")
  const publicFolder = path.join(dir, "public")
  const dev = !!options.dev
  const env = loadEnv(dev ? "development" : "production", dir)
  return {
    dir,
    dev,
    outDir,
    publicFolder,
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

    sirv(options.publicFolder, { dev: true })(req, res, next)
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

  // Copy public folder to output dir
  copyFolderSync(options.publicFolder, options.outDir)
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
