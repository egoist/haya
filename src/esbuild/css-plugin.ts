import path from "upath"
import fs from "fs"
import esbuild, { Plugin } from "esbuild"
import { localImport } from "../utils"
import type { Result as PostcssConfigResult } from "postcss-load-config"

const postcssConfigCache = new Map<string, any>()

const resolvePostcssConfig = async (
  id: string,
): Promise<PostcssConfigResult | null> => {
  const dir = path.dirname(id)
  if (postcssConfigCache.has(dir)) return postcssConfigCache.get(dir)!

  const loadConfig = await import("postcss-load-config")
  try {
    const config = await loadConfig.default({ from: id, to: id, cwd: dir }, dir)
    return config
  } catch (error: any) {
    if (!/No PostCSS Config found/.test(error.message)) {
      throw error
    }
    return null
  }
}

export const cssPlugin = (extraCssFiles: Set<string>): Plugin => {
  return {
    name: "css",

    async setup(build) {
      let postcss: typeof import("postcss") | undefined
      const dir = build.initialOptions.absWorkingDir!

      const transform = async (code: string, id: string) => {
        const config = await resolvePostcssConfig(id)
        if (!config || config.plugins.length === 0) {
          return code
        }

        postcss = postcss || (await localImport("postcss", dir))
        if (!postcss) {
          throw new Error(`You need to install "postcss" locally`)
        }

        const result = await postcss.default(config.plugins).process(code, {
          ...config.options,
          map: !!build.initialOptions.sourcemap,
        })

        code = result.css
        if (result.map) {
          // inline sourcemap
          code += `\n/*# sourceMappingURL=data:application/json;base64,${Buffer.from(
            result.map.toString(),
          ).toString("base64")} */`
        }

        return code
      }

      build.onLoad({ filter: /\.css$/ }, async (args) => {
        if (args.suffix === "?css") {
          // For link stylesheet in HTML file
          // Just load it as css
          let contents = await fs.promises.readFile(args.path, "utf8")
          contents = await transform(contents, args.path)

          return {
            loader: "css",
            contents,
          }
        }

        const result = await esbuild.build({
          ...build.initialOptions,
          metafile: true,
          entryPoints: [args.path],
          plugins: [
            ...build.initialOptions.plugins!.filter(
              (p) => p.name !== "progress" && p.name !== "css",
            ),
            {
              name: "import-css",
              setup(build) {
                build.onLoad({ filter: /\.css$/ }, async (args) => {
                  let contents = await fs.promises.readFile(args.path, "utf8")
                  contents = await transform(contents, args.path)
                  return {
                    contents,
                    loader: "css",
                  }
                })
              },
            },
          ],
        })
        if (result.errors.length > 0 || result.warnings.length > 0) {
          return {
            errors: result.errors,
            warnings: result.warnings,
          }
        }
        const file = Object.keys(result.metafile!.outputs).find((file) =>
          file.endsWith(".css"),
        )
        if (!file) {
          throw new Error(`No CSS file generated`)
        }
        const filepath = path.join(dir, file)
        const url =
          build.initialOptions.publicPath +
          path.relative(build.initialOptions.outdir!, filepath)

        if (args.suffix !== "?import-only") {
          extraCssFiles.add(filepath)
        }

        return {
          contents: `export default ${JSON.stringify(url)}`,
        }
      })
    },
  }
}
