import * as decompress from 'decompress'
import * as fs from 'fs'
import * as path from 'path'
import * as util  from 'util'
import * as xml2js from 'xml2js'

const debug = false
const TMP_DIR = 'tmp'

interface Metadata {
  [key: string]: any
}

const extractedFileRegex = /[A-Za-z:/]+([0-9]+)/
function fileSorter (file1, file2) {
  const match1 = extractedFileRegex.exec(file1)
  const match2 = extractedFileRegex.exec(file2)

  return parseInt(match1[1], 10) - parseInt(match2[1], 10)
}

async function readXmlData(xmlPath) {
  let xmlDataJson = false

  if (fs.existsSync(xmlPath)) {
    const xmlData = fs.readFileSync(xmlPath)
    const parser = new xml2js.Parser()

    await parser.parseString(xmlData, function (err, result) {
      xmlDataJson = result
    })
  }

  return xmlDataJson
}

async function extractSlideNotes(xmlDataJson, xmlPath, noteData) {
  const xmlNoteFile = xmlPath.replace('/slides/slide', '/notesSlides/notesSlide')

  if (fs.existsSync(xmlNoteFile)) {
    const xmlRelDataJson = await readXmlData(xmlNoteFile)
    for (const noteSection of xmlRelDataJson['p:notes']['p:cSld'][0]['p:spTree'][0]['p:sp']) {
      if (noteSection['p:txBody'] && noteSection['p:txBody'][0]['a:p'][0]['a:r']) {
        for (const noteParagraph of noteSection['p:txBody'][0]['a:p']) {
          if (noteParagraph['a:r']) {
            for (const noteRow of noteParagraph['a:r']) {
              if (noteRow['a:t'].length > 1) {
                console.error('multiple note rows found')
              }
              noteData.push(noteRow['a:t'][0])
            }
          }
        }
      }
    }
  }

  debug && console.log(noteData)
}

function lookupMarkdownPrefix (thing): string {
  let prefix = ''

  if (thing['p:nvSpPr'][0]['p:nvPr'][0]) {
    const thingType = thing['p:nvSpPr'][0]['p:nvPr'][0]['p:ph'][0]['$']['type']

    if (thingType == 'title' || thingType == 'ctrTitle') {
      prefix = '## '
    } else if (thingType == 'subTitle') {
      prefix = '### '
    }
  } else {
    debug && console.error('logic missing for thingType')
  }

  return prefix
}

function lookupParagraphText(paragraph) {
  let paragraphText = ''

  if (paragraph['a:r']) {
    for (const pRow of paragraph['a:r']) {
      paragraphText += pRow['a:t']
    }
  }

  return paragraphText
}

function lookupListCharacter(paragraph) {
  let listCharacter = ''

  if (paragraph['a:pPr'] && paragraph['a:pPr'][0]['a:buChar'] !== undefined) {
    if (paragraph['a:pPr'][0]['$']['lvl']) {
      listCharacter = '  '.repeat(paragraph['a:pPr'][0]['$']['lvl'])
    }
    listCharacter += paragraph['a:pPr'][0]['a:buChar'][0]['$']['char'] + ' '
  }

  return listCharacter
}

async function extractSlideImages(xmlDataJson, xmlPath, imageData) {
  if (xmlDataJson['p:sld']['p:cSld'] && 'p:pic' in xmlDataJson['p:sld']['p:cSld'][0]['p:spTree'][0]) {
    const xmlRelFile = xmlPath.replace('/slides/', '/slides/_rels/') + '.rels'
    const xmlRelDataJson = await readXmlData(xmlRelFile)
    const xmlRelationship = xmlRelDataJson['Relationships']['Relationship']

    for (const picture of xmlDataJson['p:sld']['p:cSld'][0]['p:spTree'][0]['p:pic']) {
      if (picture['p:blipFill'].length > 1) {
        console.log('multiple images')
      }

      const pictureReference = picture['p:blipFill'][0]['a:blip'][0]['$']['r:embed']
      const imagePaths = xmlRelationship.filter(reference => reference['$']['Id'] == pictureReference)
      const imagePath = imagePaths[0]['$']['Target'].replace('../media', '/<provider>/<category>/<offering>/assets/images')
      imageData.push(`![${pictureReference}](${imagePath})`, '')
    }
  }
}

function extractSlideText(xmlDataJson, textData) {
  if ('p:spTree' in xmlDataJson['p:sld']['p:cSld'][0]) {
    for (const thing of xmlDataJson['p:sld']['p:cSld'][0]['p:spTree'][0]['p:sp']) {
      const markdownPrefix = lookupMarkdownPrefix(thing)

      for (const paragraph of thing['p:txBody'][0]['a:p']) {
        const listCharacter = lookupListCharacter(paragraph)
        const paragraphText = lookupParagraphText(paragraph)

        if (paragraphText) {
          const slideMarkdown = markdownPrefix + listCharacter + paragraphText
          if (slideMarkdown.startsWith('### ')) { // better with regex
            textData.unshift(slideMarkdown, '')
          } else if (slideMarkdown.startsWith('## ')) {
            textData.unshift(slideMarkdown, '')
          } else if (slideMarkdown != ''){
            textData.push(slideMarkdown)
          }
        }
      }
    }
  }
}

async function extractSlideData(xmlPath: string) {
  // const slideContent = []
  const xmlDataJson = await readXmlData(xmlPath)
  const slideContent = {
    text: [],
    images: [],
    notes: [],
  }

  if (xmlDataJson) {
    await extractSlideText(xmlDataJson, slideContent.text)
    await extractSlideImages(xmlDataJson, xmlPath, slideContent.images)
    await extractSlideNotes(xmlDataJson, xmlPath, slideContent.notes)
  }
  return slideContent
}

function filterFilesData(extractedFiles: Metadata[], contentPath: string) {
  return extractedFiles
  .filter(files => files.path.startsWith(contentPath))
  .map(slides => slides.path)
  .sort(fileSorter)
}

export async function processSlides(extractionPath: string, extractedFiles: Metadata[]) {
  debug && console.log(`extraction path ${extractionPath}`)
  const slideFiles = filterFilesData(extractedFiles, 'ppt/slides/slide')
  const slidePack = []

  for (const extractedFile of slideFiles) {
    await extractSlideData(path.join(extractionPath, extractedFile))
    .then(slideData => {
      if (slideData.text.length || slideData.images.length || slideData.notes.length) {
        slidePack.push('---', '')
        if (slideData.text.length) {
          slidePack.push(...slideData.text)
        }
        if (slideData.images.length) {
          slidePack.push('', ...slideData.images)
        }
        if (slideData.notes.length) {
          slidePack.push('Note:', '', ...slideData.notes)
        }
      }
    })
  }

  return slidePack
}

export async function powerDown(sourceFilePath: string, destPath?: string) {
  const projectRoot = path.join(__dirname, '..')
  const extractPath = path.join(projectRoot, TMP_DIR, path.basename(sourceFilePath))

  if (fs.existsSync(sourceFilePath)) {
    await decompress(sourceFilePath, extractPath)
    .then((files: Metadata[]) => {
      return processSlides(extractPath, files)
    })
    .then(foo => {
      // save to file
      console.log(foo)
    })
  }

  return destPath
}
