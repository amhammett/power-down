import * as path from 'path'
import * as extract from './extract'

async function main() {
  const projectRoot = path.join(__dirname, '..')
  const sourceFilePath = path.join(projectRoot, 'sample.pptx')

  const destPath = await extract.powerDown(sourceFilePath)

  console.log(`Markdown generated within ${destPath}`)
}

main()
