import fs from "fs"
import path from "upath"

export const outputFileSync = (filepath: string, data: any) => {
  const dir = path.dirname(filepath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(filepath, data)
}

export const copyFolderSync = (src: string, dest: string) => {
  const files = fs.readdirSync(src)
  files.forEach((file) => {
    const srcFile = path.join(src, file)
    const destFile = path.join(dest, file)
    const srcStat = fs.statSync(srcFile)
    if (srcStat.isDirectory()) {
      copyFolderSync(srcFile, destFile)
    } else {
      fs.mkdirSync(path.dirname(destFile), { recursive: true })
      fs.copyFileSync(srcFile, destFile)
    }
  })
}

export const removeFolderSync = (dir: string) => {
  dir = path.resolve(dir)
  if (dir !== path.resolve()) {
    fs.rmSync(dir, {
      force: true,
      recursive: true,
    })
  }
}
