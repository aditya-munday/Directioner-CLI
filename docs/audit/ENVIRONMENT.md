# Environment Report and Build Verification

First Action items 1 and 2 of the brief. All output below is real, from this
machine, on 2026-09-28.

---

## 1. Environment

| Tool | Status |
|---|---|
| `git` | 2.47.3 ✅ |
| `gh` | 2.101.0 ✅ installed — ⚠ **NOT authenticated** |
| `node` | v24.21.0 ✅ |
| `npm` | 11.19.1 ✅ |
| `bun` | ❌ not installed → **installed 1.3.14** (see below) |
| `docker` | 29.8.1 ✅ installed (daemon not started in this session) |
| `python3` | 3.13.15 ✅ |
| `jq` | 1.7 ✅ |
| `ripgrep` (`rg`) | ❌ not on PATH (the repo vendors its own ripgrep at build time) |
| `strace` | ❌ not installed — **needed for the Stage 1 runtime egress test** |

### ⚠ `gh` is not authenticated and `GITHUB_TOKEN` is not set

```
$ gh auth status
You are not logged into any GitHub hosts. To log in, run: gh auth login
$ [ -n "$GITHUB_TOKEN" ] … → no
```

This blocks the PR part of boundary 1 ("branch, open a PR with gh, then stop").
I can commit locally on a branch now; I **cannot open a PR** until a token is
provided. Flagging before Stage 1 rather than discovering it at push time.

### Network access
`registry.npmjs.org`, `github.com`, `api.github.com` all return 200. Outbound
HTTPS works.

### Bun install
`npm install -g bun` failed (no write permission to the global prefix). Installed
locally instead and put it on PATH:

```
npm install bun@1.3.14 --no-save         # in ~/.bun-install
cp …/@oven/bun-linux-x64-baseline/bin/bun ~/.bun/bin/bun
export PATH="$HOME/.bun/bin:$PATH"       # appended to ~/.bashrc
bun --version → 1.3.14
```

Note: the plain `bun-linux-x64` package's `bin/` was empty (its postinstall
download step was skipped by npm's install-script policy); the `-baseline`
variant carries a working binary. `.bun-version` pins **1.3.14**, which is what
was installed.

---

## 2. Checkout

```
$ git remote -v
origin  https://github.com/BeyondersAI/directioner.git (fetch/push)
$ git branch --show-current
build/fix-ai-sdk-json-types
$ git log --oneline -3
4441b48fc (HEAD) Fix AI SDK v7 JSON type incompatibility so the SDK build succeeds
f0b399737 (origin/main, origin/HEAD, main) Sync public snapshot from directioner-private
7eb27f6ab Sync public snapshot from directioner-private
```

Path: `/workspace/project` (the brief's `<FILL IN PATH>` was blank; see
`0-DISCREPANCIES.md` D1).

---

## 3. Build verification — both stages pass

### Dependencies
```
$ bun install
bun install v1.3.14 (0d9b296a)
Checked 813 installs across 803 packages (no changes) [321.00ms]
```
Exit 0. `bun.lock` matches.

### SDK build
```
$ bun run build:sdk
  ✓ Fixed duplicate imports in bundled types
  ✓ Created bundled type definitions
  … (tree-sitter WASM × 11, vendored ripgrep)
✅ Build complete!
  📄 dist/index.mjs (ESM) / dist/index.cjs (CJS) / dist/index.d.ts (Types)
EXIT=0
```

### Directioner binary build
```
$ <NEXT_PUBLIC_* env vars sourced> bun run build:directioner
$ bun directioner/cli/build.ts 0.0.0-dev
Building Directioner v0.0.0-dev...
✅ Built directioner (linux-x64)
✅ Directioner v0.0.0-dev built successfully

real    0m12.939s
-rwxr-xr-x 1 openhands openhands 135895168  cli/bin/directioner   # ~129.6 MiB
```

### Binary runs
```
$ ./cli/bin/directioner --version
0.0.0-dev
EXIT=0

$ ./cli/bin/directioner --help
Usage: directioner [options] [command]
Directioner - Free AI coding assistant
Arguments:  command   Command to run (choices: "login")
Options: -v/--version, --continue [id], --cwd <directory>,
         --trust-agents, -h/--help
EXIT=0
```

`--help` confirms the small Directioner argv surface described in
`0b-feature-inventory.md`, and confirms the compile-time env vars were inlined
successfully (a build without them fails at startup validation).

### The env values used (throwaway build-time placeholders)
```
NEXT_PUBLIC_CB_ENVIRONMENT=prod
NEXT_PUBLIC_BEYONDERS_APP_URL=https://beyonders.com
NEXT_PUBLIC_SUPPORT_EMAIL=support@beyonders.com
NEXT_PUBLIC_POSTHOG_API_KEY=phc_buildtest
NEXT_PUBLIC_POSTHOG_HOST_URL=https://us.i.posthog.com
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_buildtest
NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL=https://billing.stripe.com/p/login/test
NEXT_PUBLIC_WEB_PORT=3000
```
None are real credentials. No real API keys exist.

---

## 4. Notes for the next stage

- **`strace` is missing** and the Stage 1 egress test wants it (or a logging
  proxy, or a network namespace). Plan to install it or use the proxy approach.
- **Docker daemon** is not running; not needed for Stage 0.
- **`gh` auth** is the one hard blocker to raising a PR.
- The repo already has a working CI recipe to copy:
  `.github/workflows/ci.yml` builds the SDK, builds the binary, and smoke-tests
  it with the same `NEXT_PUBLIC_*` set. Stage 1's GitHub Actions build can start
  from this file.
