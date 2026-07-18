import { Buffer } from 'node:buffer'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(scriptDirectory)
const sourcePath = join(projectRoot, 'resources', 'icon-source.svg')
const outputPath = join(projectRoot, 'resources', 'icon.ico')
const temporaryDirectory = join(projectRoot, '.tmp', 'icon-generation')
const sizes = [16, 32, 48, 256]

await rm(temporaryDirectory, { recursive: true, force: true })
await mkdir(temporaryDirectory, { recursive: true })

try {
  const source = await readFile(sourcePath)
  const pngPaths = []

  for (const size of sizes) {
    const pngPath = join(temporaryDirectory, `icon-${size}.png`)
    const png = await sharp(source)
      .resize(size, size, { fit: 'fill' })
      .png({ adaptiveFiltering: false, compressionLevel: 9, palette: false })
      .toBuffer()

    await writeFile(pngPath, png)
    pngPaths.push(pngPath)
  }

  const icon = await pngToIco(pngPaths)
  if (!icon.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00]))) {
    throw new Error('INVALID_ICO_HEADER')
  }
  if (icon.readUInt16LE(4) !== sizes.length) {
    throw new Error('INVALID_ICO_DIRECTORY_COUNT')
  }

  await writeFile(outputPath, icon)
  stdout.write(`Generated ${outputPath} with ${sizes.length} image sizes.\n`)
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
