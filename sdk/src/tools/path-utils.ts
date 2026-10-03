import { existsSync, lstatSync, realpathSync } from 'fs'
import path from 'path'

import { translateGitBashPath } from './windows-bash'

import type { WindowsShellPathDependencies } from './windows-bash'

export type ResolvedProjectPath = {
  fullPath: string
  relativePath: string
}

/**
 * Filesystem primitives the containment check needs, injectable so the check
 * can be exercised against a real filesystem (the default) or driven
 * deterministically in a unit test.
 *
 * `realpath` must resolve symlinks. `exists` must NOT follow the final
 * component in a way that hides a dangling link; the walk only uses it to find
 * the deepest ancestor that can be realpath'd.
 */
export type PathContainmentDependencies = {
  realpath?: (p: string) => string
  exists?: (p: string) => boolean
  /**
   * Must NOT follow the final component. Used to detect a symlink at the last
   * path segment, including a dangling one that `realpath` cannot resolve.
   */
  lstat?: (p: string) => { isSymbolicLink(): boolean }
}

/**
 * The result of asking whether a resolved path stays inside the project.
 *
 * `lexicalWithin` is the string-only answer (the historical meaning of
 * "within project"): `..` is applied and the result compared to the root.
 * `realWithin` is the filesystem answer, or `null` when the filesystem could
 * not be consulted. The two disagree exactly in the symlink-escape case, which
 * is why they are reported separately rather than collapsed into one boolean.
 */
export type PathContainment = {
  /** The path with the deepest existing ancestor's symlinks resolved. */
  containedPath: string
  /** True when the path is inside the root after `..` is applied. */
  lexicalWithin: boolean
  /** True when the real path is inside the root; null when unproven. */
  realWithin: boolean | null
  /**
   * True only when the lexical path is inside the root AND the filesystem was
   * consulted AND the real path is outside. A repository-planted symlink has
   * this shape; it is never inferred from an unresolved filesystem.
   */
  escapesViaSymlink: boolean
  /**
   * True when the final path component is a symlink. A write must resolve it
   * rather than write through it: `exists`/`realpath` both follow it, so a link
   * pointing outside the project would otherwise be indistinguishable from an
   * ordinary file. Only reported when the filesystem was consulted.
   */
  finalComponentIsSymlink: boolean
  /**
   * True when the final component is a symlink whose target does not exist.
   * `realpath` throws on this, so the deepest-existing walk stops at the parent
   * and the path it returns is the LINK itself. Writing to that path would
   * create the link's target, which may be outside the project, so it is
   * refused rather than resolved.
   */
  danglingLeafSymlink: boolean
}

const DEFAULT_CONTAINMENT: Required<PathContainmentDependencies> = {
  realpath: realpathSync,
  exists: existsSync,
  lstat: (p: string) => lstatSync(p),
}

/**
 * True when the last path component is a symlink, without following it.
 *
 * A dangling link is the case that matters: `realpath` throws on it, so a
 * "resolve and compare" check cannot see it at all, while a write would create
 * the link's target wherever it points.
 */
function leafIsSymlink(
  target: string,
  deps: Required<PathContainmentDependencies>,
): boolean {
  try {
    return deps.lstat(target).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * True when the leaf is a symlink whose target does not exist.
 *
 * `exists` follows the link, so a dangling link reports false and the
 * deepest-existing walk settles on the link's PARENT — making the link look
 * like an ordinary not-yet-created file inside the project. Writing that path
 * creates the link's target, which may be anywhere, so this case must be
 * refused rather than treated as a new file.
 */
function leafIsDanglingSymlink(
  target: string,
  deps: Required<PathContainmentDependencies>,
): boolean {
  return leafIsSymlink(target, deps) && !deps.exists(target)
}

/**
 * Realpath the deepest EXISTING ancestor of `target`, then re-join the tail
 * that does not exist yet. Only the existing part can carry a symlink, and the
 * tail is what makes this answerable for a file that has not been created.
 *
 * Returns `null` when the filesystem could not be consulted (for example a
 * virtual filesystem in a test), so the caller can report containment as
 * unproven rather than silently guessing.
 */
function resolveDeepestExisting(
  target: string,
  deps: Required<PathContainmentDependencies>,
): string | null {
  const tail: string[] = []
  let existing = target
  try {
    while (!deps.exists(existing)) {
      const parent = path.dirname(existing)
      if (parent === existing) break
      tail.unshift(path.basename(existing))
      existing = parent
    }
    const realExisting = deps.realpath(existing)
    return tail.length > 0
      ? path.join(realExisting, ...tail)
      : realExisting
  } catch {
    return null
  }
}

/**
 * Decide whether `fullPath` stays inside `projectRoot`, resolving symlinks in
 * the existing portion so a link that points out of the project is detected.
 *
 * `lexicalWithin` is always answerable; `realWithin` is `null` when the
 * filesystem refused, which callers must treat as unproven rather than as
 * either answer.
 */
export function checkPathContainment(
  projectRoot: string,
  fullPath: string,
  dependencies: PathContainmentDependencies = {},
): PathContainment {
  const deps = { ...DEFAULT_CONTAINMENT, ...dependencies }
  const resolvedRoot = path.resolve(projectRoot)

  const lexicalRelative = path.relative(resolvedRoot, fullPath)
  const lexicalWithin =
    lexicalRelative === '' || !escapesProject(lexicalRelative)

  const resolvedPath = resolveDeepestExisting(fullPath, deps)
  if (resolvedPath === null) {
    return {
      containedPath: fullPath,
      lexicalWithin,
      realWithin: null,
      escapesViaSymlink: false,
      finalComponentIsSymlink: false,
      danglingLeafSymlink: false,
    }
  }

  let realRoot = resolvedRoot
  try {
    realRoot = deps.realpath(resolvedRoot)
  } catch {
    // A root that cannot be realpath'd leaves the real answer unproven.
    return {
      containedPath: resolvedPath,
      lexicalWithin,
      realWithin: null,
      escapesViaSymlink: false,
      finalComponentIsSymlink: false,
      danglingLeafSymlink: false,
    }
  }

  const realRelative = path.relative(realRoot, resolvedPath)
  const realWithin = realRelative === '' || !escapesProject(realRelative)

  return {
    containedPath: resolvedPath,
    lexicalWithin,
    realWithin,
    escapesViaSymlink: lexicalWithin && !realWithin,
    finalComponentIsSymlink: leafIsSymlink(fullPath, deps),
    danglingLeafSymlink: leafIsDanglingSymlink(fullPath, deps),
  }
}

export type ResolvedFilePath = ResolvedProjectPath & {
  /** Whether the resolved path lives inside `projectRoot`. */
  isWithinProject: boolean
  /**
   * True when the lexical path is inside the project but resolving the existing
   * portion's symlinks lands outside. A write through such a path modifies a
   * file outside the project while every string check says "inside".
   */
  escapesViaSymlink: boolean
}

function escapesProject(relativePath: string): boolean {
  return (
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  )
}

export function resolveFilePathWithinProject(
  projectRoot: string,
  filePath: string,
  dependencies: WindowsShellPathDependencies = {},
): ResolvedProjectPath | null {
  const resolvedRoot = path.resolve(projectRoot)
  const nativeFilePath = translateGitBashPath(filePath, dependencies)
  const fullPath = path.isAbsolute(nativeFilePath)
    ? path.resolve(nativeFilePath)
    : path.resolve(resolvedRoot, nativeFilePath)
  const relativePath = path.relative(resolvedRoot, fullPath)

  if (relativePath === '' || escapesProject(relativePath)) {
    return null
  }

  return { fullPath, relativePath }
}

/**
 * Resolves a file path against the project root without restricting it to the
 * project directory. Absolute paths are honored as-is and relative paths are
 * resolved against the project root, so callers can operate on any file on the
 * system. `relativePath` is a friendly display value: the project-relative path
 * when the target is inside the project, otherwise the absolute path.
 * `isWithinProject` lets callers skip project-scoped logic (e.g. gitignore) for
 * files that live outside the project.
 * On Windows, a single-leading-slash path uses Git Bash semantics because that
 * is the shell exposed to agents; native absolute paths retain their drive or
 * UNC prefix.
 */
export function resolveFilePath(
  projectRoot: string,
  filePath: string,
  dependencies: WindowsShellPathDependencies = {},
  containmentDependencies: PathContainmentDependencies = {},
): ResolvedFilePath {
  const resolvedRoot = path.resolve(projectRoot)
  const nativeFilePath = translateGitBashPath(filePath, dependencies)
  const fullPath = path.isAbsolute(nativeFilePath)
    ? path.resolve(nativeFilePath)
    : path.resolve(resolvedRoot, nativeFilePath)
  const relativePath = path.relative(resolvedRoot, fullPath)
  const lexicallyWithin = relativePath !== '' && !escapesProject(relativePath)

  // A lexical "inside" is not the whole answer: the existing portion of the
  // path may be a symlink that leaves the project. `containment` answers the
  // filesystem question, and the two disagree exactly in the symlink case.
  const containment = checkPathContainment(
    resolvedRoot,
    fullPath,
    containmentDependencies,
  )
  const displayPath = lexicallyWithin ? relativePath : fullPath

  return {
    fullPath,
    relativePath: displayPath,
    // Kept lexical so a virtual filesystem (and every existing caller) sees
    // the same answer as before. The symlink escape is reported separately.
    isWithinProject: lexicallyWithin,
    escapesViaSymlink: containment.escapesViaSymlink,
  }
}

/**
 * Host-authorized exceptions to the project write boundary.
 *
 * The default is that a write must land inside the project root. A user who
 * genuinely wants the agent to touch a file elsewhere (a scratch directory, a
 * second checkout, `~/.config`) authorizes it here, explicitly, at the host
 * layer — never by the model asking nicely in a tool argument.
 */
export type PathBoundaryOptions = {
  /** Roots outside the project that a write is authorized to target. */
  additionalRoots?: readonly string[]
  /**
   * Authorize any absolute path the process can write. Off by default; this is
   * the blunt instrument, and `additionalRoots` is the scoped one.
   */
  allowAnyAbsolutePath?: boolean
  /** Filesystem primitives for the containment decision (tests inject these). */
  containment?: PathContainmentDependencies
  /** Git Bash path translation inputs; tests inject these to avoid spawning. */
  windowsShell?: WindowsShellPathDependencies
}

/**
 * Host-authorized exceptions to the project path boundary, shared by the read
 * and write tools. The default (nothing passed) confines every model-requested
 * path to the project root.
 */
export type PathBoundary = PathBoundaryOptions

export type PathBoundaryDecision =
  | {
      allowed: true
      fullPath: string
      relativePath: string
      /**
       * The authorized root `fullPath` was matched against, canonicalized.
       * `undefined` only for the host's explicit `allowAnyAbsolutePath` opt-in,
       * where there is no root to pin to. A destructive write pins its walk to
       * this root so a directory swapped for a symlink after the check is
       * refused by the kernel instead of followed.
       */
      root?: string
    }
  | { allowed: false; fullPath: string; reason: string }

function isLexicallyWithin(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), target)
  return relative === '' || !escapesProject(relative)
}

/**
 * Decide whether a model-requested write may proceed.
 *
 * This is an AUTHORIZATION check layered on top of the path resolution, and it
 * is deliberately separate from validation: a syntactically valid path is not
 * an authorized one. The model can request any string; only the project root
 * (plus host-authorized roots) may be written.
 *
 * Two failures are distinguished because they are different problems:
 *  - outside the authorized roots: a path the model chose that leaves the
 *    boundary, refused outright;
 *  - a symlink escape: a path that reads as inside the project but resolves
 *    outside it, which is what a repository-planted link looks like.
 */
export function resolveWritePath(
  projectRoot: string,
  filePath: string,
  options: PathBoundaryOptions = {},
  containmentDependencies: PathContainmentDependencies = {},
): PathBoundaryDecision {
  // Both sources matter: the explicit 4th argument and the boundary option.
  // A 4th argument that defaults to {} must not mask options.containment.
  const deps = { ...(options.containment ?? {}), ...containmentDependencies }
  const resolved = resolveFilePath(
    projectRoot,
    filePath,
    options.windowsShell ?? {},
    deps,
  )
  const fullPath = resolved.fullPath
  const roots = [path.resolve(projectRoot), ...(options.additionalRoots ?? [])]

  // An explicit, host-level "any absolute path" opt-in is honored as written.
  if (options.allowAnyAbsolutePath && path.isAbsolute(fullPath)) {
    return { allowed: true, fullPath, relativePath: fullPath }
  }

  for (const root of roots) {
    const containment = checkPathContainment(root, fullPath, deps)
    // `realWithin === null` means the filesystem could not be consulted (a
    // virtual fs); fall back to the lexical answer there. A `false` is a
    // proven escape and never authorizes the write.
    const withinRoot =
      containment.lexicalWithin && containment.realWithin !== false
    if (!withinRoot) continue

    // A link whose target does not exist resolves to the link's PARENT in the
    // deepest-existing walk, so it looks like an ordinary new file. Writing it
    // would create the target — possibly outside the project — so refuse.
    if (containment.danglingLeafSymlink) {
      return {
        allowed: false,
        fullPath,
        reason: `Refused: "${filePath}" is a symlink to a path that does not exist. Writing it would create the link's target, which may be outside the project.`,
      }
    }

    // A link that resolves to a real file inside the project is allowed, but
    // the write must target the RESOLVED path. Otherwise the tool would write
    // through the link, and a later swap of the link's target would redirect
    // the write outside the boundary (the TOCTOU shape).
    const writePath = containment.finalComponentIsSymlink
      ? containment.containedPath
      : fullPath

    return {
      allowed: true,
      fullPath: writePath,
      relativePath: isLexicallyWithin(projectRoot, writePath)
        ? path.relative(path.resolve(projectRoot), writePath)
        : writePath,
      root,
    }
  }

  if (resolved.escapesViaSymlink) {
    return {
      allowed: false,
      fullPath,
      reason: `Refused: "${filePath}" is inside the project by name but resolves through a symlink to a location outside it. Writes must not follow a link out of the project.`,
    }
  }

  return {
    allowed: false,
    fullPath,
    reason: `Refused: "${filePath}" is outside the project. The agent may only write inside the project directory.`,
  }
}

/**
 * Decide whether a READ of `filePath` is inside the authorized roots.
 *
 * Reads are the other half of the same boundary. A path table that guards
 * writes but not reads still lets a repository-planted symlink exfiltrate
 * `~/.ssh/id_rsa` or `/etc/passwd` into the model's context, which is the
 * harm the boundary exists to prevent. The difference from `resolveWritePath`
 * is that reading a symlink is fine — the read follows it — so only the
 * resolved location has to be contained; there is no leaf-link swap hazard,
 * because a read cannot modify anything.
 */
export function resolveReadPath(
  projectRoot: string,
  filePath: string,
  options: PathBoundaryOptions = {},
  containmentDependencies: PathContainmentDependencies = {},
): PathBoundaryDecision {
  // Both sources matter: the explicit 4th argument and the boundary option.
  // A 4th argument that defaults to {} must not mask options.containment.
  const deps = { ...(options.containment ?? {}), ...containmentDependencies }
  const resolved = resolveFilePath(
    projectRoot,
    filePath,
    options.windowsShell ?? {},
    deps,
  )
  const fullPath = resolved.fullPath
  const roots = [path.resolve(projectRoot), ...(options.additionalRoots ?? [])]

  if (options.allowAnyAbsolutePath && path.isAbsolute(fullPath)) {
    return { allowed: true, fullPath, relativePath: fullPath }
  }

  for (const root of roots) {
    const containment = checkPathContainment(root, fullPath, deps)
    const withinRoot =
      containment.lexicalWithin && containment.realWithin !== false
    if (!withinRoot) continue
    return {
      allowed: true,
      fullPath,
      relativePath: isLexicallyWithin(projectRoot, fullPath)
        ? path.relative(path.resolve(projectRoot), fullPath)
        : fullPath,
    }
  }

  if (resolved.escapesViaSymlink) {
    return {
      allowed: false,
      fullPath,
      reason: `Refused: "${filePath}" is inside the project by name but resolves through a symlink to a location outside it. Reads must not follow a link out of the project.`,
    }
  }

  return {
    allowed: false,
    fullPath,
    reason: `Refused: "${filePath}" is outside the project. The agent may only read files inside the project directory.`,
  }
}

export function getProjectPathLookupKeys(
  projectRoot: string,
  filePath: string,
  dependencies: WindowsShellPathDependencies = {},
): string[] {
  const resolvedPath = resolveFilePathWithinProject(
    projectRoot,
    filePath,
    dependencies,
  )
  const keys = resolvedPath
    ? [resolvedPath.relativePath, filePath]
    : [
        resolveFilePath(projectRoot, filePath, dependencies).relativePath,
        filePath,
      ]

  return [...new Set(keys)]
}
