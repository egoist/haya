import timeSpan, { TimeEndFunction } from "time-span"
import { removeFolderSync } from "../fs"
import { Plugin } from "../plugin"

export const progressPlugin = (): Plugin => {
  return {
    name: "progress",
    setup(build) {
      let end: TimeEndFunction | undefined
      build.onStart(async () => {
        if (build.isChildBundler()) return
        end = timeSpan()
        build.resetState()
        removeFolderSync(build.initialOptions.outdir!)
      })
      build.onEnd(() => {
        if (build.isChildBundler()) return
        if (end) {
          console.log(`⚡️ Built in ${end.rounded()}ms`)
        }
      })
    },
  }
}
