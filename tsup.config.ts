import { builtinModules } from "module"
import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["./src/cli.ts", "./src/index.ts"],
  clean: true,
  target: "node16",
  format: ["esm"],
  banner: {
    js:
      `import {createRequire as __createRequire} from 'module';var require = __createRequire(import` +
      `.meta.url);`,
  },
  esbuildPlugins: [
    {
      name: "fix-require-builtin-modules",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (
            args.kind === "require-call" &&
            builtinModules.some(
              (name) => name === args.path || args.path.startsWith(`${name}/`),
            )
          ) {
            return {
              path: args.path,
              namespace: "builtin",
              pluginData: {
                resolveDir: args.resolveDir,
              },
            }
          }
        })

        build.onLoad({ filter: /.*/, namespace: "builtin" }, (args) => {
          return {
            contents: `export * from "${args.path}"
            `,
            loader: "js",
            resolveDir: args.pluginData.resolveDir,
          }
        })
      },
    },
  ],
})
