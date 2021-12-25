import path from "path"
import { Plugin } from "esbuild"

export const workerPlugin = (): Plugin => {
  return {
    name: "worker",
    setup(build) {
      const dir = build.initialOptions.absWorkingDir!
      build.onLoad({ filter: /.*/ }, async (args) => {
        const isWorker = args.suffix === "?worker"
        const isSharedWorker = args.suffix === "?shared-worker"
        if (isWorker || isSharedWorker) {
          const result = await build.esbuild.build({
            ...build.initialOptions,
            incremental: false,
            plugins: [],
            entryPoints: [args.path],
            logLevel: "silent",
          })
          if (result.errors.length > 0 || result.warnings.length > 0) {
            return {
              errors: result.errors,
              warnings: result.warnings,
            }
          }
          const file = Object.keys(result.metafile!.outputs).find((file) =>
            file.endsWith(".js"),
          )
          const filepath = path.join(dir, file!)
          const url =
            build.initialOptions.publicPath +
            path.relative(build.initialOptions.outdir!, filepath)

          return {
            contents: `export default class MyWorker extends ${
              isSharedWorker ? "SharedWorker" : "Worker"
            } {
                constructor() {
                    super(${JSON.stringify(url)})
                }
            }`,
            loader: "js",
          }
        }
      })
    },
  }
}
