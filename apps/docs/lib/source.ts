import { docs, meta } from '@/.source'
import { loader, type Source } from 'fumadocs-core/source'

const collection: Source<{ pageData: (typeof docs)[number]; metaData: (typeof meta)[number] }> = {
  files: [
    ...docs.map((data) => ({
      type: 'page' as const,
      path: data._file.path,
      absolutePath: data._file.absolutePath,
      data,
    })),
    ...meta.map((data) => ({
      type: 'meta' as const,
      path: data._file.path,
      absolutePath: data._file.absolutePath,
      data,
    })),
  ],
}

export const source = loader({
  baseUrl: '/docs',
  source: collection,
})
