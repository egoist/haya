#!/usr/bin/env node
import { cac } from "cac"
import { version } from "../package.json"

const cli = cac("vei")

cli
  .command("[dir]", "Start dev server")
  .option("--port <number>", "Listen on a custom port (default: 3000)")
  .action(async (dir, flags) => {
    const { createServer } = await import("./")
    const { config } = await createServer(
      { dir, dev: true },
      { server: { port: flags.port } },
    )
    console.log(`> http://localhost:${config.data.server.port}`)
  })

cli.command("build [dir]", "Start dev server").action(async (dir) => {
  const { build } = await import("./")
  await build({ dir, dev: false })
})

cli
  .command("preview [dir]", "Preview a production build")
  .option("--port <number>", "Listen on a custom port (default: 3000)")
  .action(async (dir, flags) => {
    const { preview } = await import("./")
    const { config } = await preview(
      { dir, dev: true },
      { server: { port: flags.port } },
    )
    console.log(`> http://localhost:${config.data.server.port}`)
  })

cli.version(version)
cli.help()
cli.parse()
