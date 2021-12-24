import fs from "fs"
import { Plugin } from "esbuild"

export const rawPlugin = (): Plugin => {
  return {
    name: "raw",
    setup(build) {
      build.onLoad({ filter: /.*/ }, async (args) => {
        if (args.suffix === "?raw") {
          return {
            contents: await fs.promises.readFile(args.path, "utf8"),
            loader: "text",
          }
        }
      })
    },
  }
}
