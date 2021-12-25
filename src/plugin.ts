import {
  PluginBuild as _PluginBuild,
  Plugin as EsbuildPlugin,
  OnResolveOptions,
  OnResolveArgs,
  OnResolveResult,
  OnLoadOptions,
  OnLoadArgs,
  OnLoadResult,
} from "esbuild"

export type BuildState = {
  extraCssFiles: Set<string>
  watchFiles: Set<string>
  watchDirs: Set<string>
  [k: string]: any
}

export interface PluginBuild extends _PluginBuild {
  collectCssFile: (absPath: string | string[]) => void
  addWatchFiles: (absPath: string | string[]) => void
  addWatchDirs: (absPath: string | string[]) => void
  resetState: () => void
  isChildBundler: () => boolean
  state: BuildState
}

type MaybePromise<T> = Promise<T> | T

export type Plugin = {
  name: string
  setup(build: PluginBuild): void | Promise<void>
}

const arraify = <T>(x: T | T[]): T[] => (Array.isArray(x) ? x : [x])

const toEsbuildError = (error: Error, pluginName: string) => {
  return { text: error.message, pluginName }
}

export const wrapEsbuildPlugins = (
  plugins: (Plugin | EsbuildPlugin)[],
  state: BuildState,
  ignorePlugins?: string[],
): EsbuildPlugin => {
  return {
    name: "plugin-wrapper",
    // @ts-expect-error
    async setup(build: PluginBuild) {
      build.collectCssFile = (absPath) =>
        arraify(absPath).forEach((p) => state.extraCssFiles.add(p))
      build.addWatchFiles = (absPath) =>
        arraify(absPath).forEach((p) => state.watchFiles.add(p))
      build.addWatchDirs = (absPath) =>
        arraify(absPath).forEach((p) => state.watchDirs.add(p))
      build.resetState = () => {
        state.extraCssFiles.clear()
        state.watchFiles.clear()
        state.watchDirs.clear()
      }
      build.isChildBundler = () => {
        return !!build.initialOptions.define!["__ESBUILD_CHILD__"]
      }
      build.state = state

      const onResolves: {
        pluginName: string
        options: OnResolveOptions
        callback: (
          args: OnResolveArgs,
        ) => MaybePromise<OnResolveResult | undefined | null>
      }[] = []
      const onLoads: {
        pluginName: string
        options: OnLoadOptions
        callback: (
          args: OnLoadArgs,
        ) => MaybePromise<OnLoadResult | undefined | null>
      }[] = []

      for (const plugin of plugins) {
        if (ignorePlugins?.includes(plugin.name)) {
          continue
        }
        const pluginName = plugin.name

        const buildProxy: PluginBuild = {
          ...build,
          onResolve(options, callback) {
            onResolves.push({ pluginName, options, callback })
          },
          onLoad(options, callback) {
            onLoads.push({ pluginName, options, callback })
          },
        }
        await plugin.setup(buildProxy)
      }

      for (const onResolve of onResolves) {
        build.onResolve(onResolve.options, async (args) => {
          const result = await Promise.resolve(onResolve.callback(args)).catch(
            (error) => {
              return {
                errors: [toEsbuildError(error, onResolve.pluginName)],
              } as OnResolveResult
            },
          )
          if (result?.watchFiles) {
            build.addWatchFiles(result.watchFiles)
          }
          if (result?.watchDirs) {
            build.addWatchDirs(result.watchDirs)
          }
          if (result) {
            result.pluginName = onResolve.pluginName
          }
          return result
        })
      }

      for (const onLoad of onLoads) {
        build.onLoad(onLoad.options, async (args) => {
          const result = await Promise.resolve(onLoad.callback(args)).catch(
            (error) => {
              return {
                errors: [toEsbuildError(error, onLoad.pluginName)],
              } as OnLoadResult
            },
          )
          if (result?.watchFiles) {
            build.addWatchFiles(result.watchFiles)
          }
          if (result?.watchDirs) {
            build.addWatchDirs(result.watchDirs)
          }
          if (result) {
            result.pluginName = onLoad.pluginName
          }
          return result
        })
      }
    },
  }
}
