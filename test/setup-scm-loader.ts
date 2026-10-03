/**
 * Bun test preload: teach the bundler to import tree-sitter `.scm` query files
 * as text.
 *
 * `@beyonders/code-map` imports its query files with `import q from './x.scm'`
 * and the bundler inlines them as strings. Bun's test runner does not know the
 * extension, so without this plugin importing the SDK barrel fails at load
 * time — before any test body runs — and the failure is easy to misread as an
 * unrelated suite error.
 *
 * Loaded via `preload` in cli/bunfig.toml.
 */

import { plugin } from 'bun'

plugin({
  name: 'scm-text-loader',
  setup(build) {
    build.onLoad({ filter: /\.scm$/ }, async (args) => {
      const text = await Bun.file(args.path).text()
      return {
        contents: `export default ${JSON.stringify(text)}`,
        loader: 'js',
      }
    })
  },
})
