import type fs from 'fs'

/** File system used for Beyonders SDK.
 *
 * Compatible with `fs.promises` from the `'fs'` module.
 */
export type BeyondersFileSystem = Pick<
  typeof fs.promises,
  'mkdir' | 'readdir' | 'readFile' | 'stat' | 'unlink' | 'writeFile'
>
