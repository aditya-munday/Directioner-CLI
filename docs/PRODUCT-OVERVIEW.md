# Product overview

## What Directioner CLI is

Directioner CLI is a locally installed, terminal-based AI coding agent. You
describe a task; it inspects your project, reasons about it, uses tools to make
changes within its boundaries, runs checks, and reports what actually happened.

It is one client in the Directioner ecosystem and talks to the user directly. It
does not require a voice assistant, a browser, or a hosted service to run.

## Who it is for

Developers and engineers working in a terminal who want an agent that operates on
a local project and verifies its own work — for tasks such as fixing a bug,
explaining a build failure, refactoring a module, or diagnosing failing tests.

## What it can currently do

This repository ships a **standalone, bring-your-own-key (BYOK)** build. The
following are available and evidenced:

- A local terminal agent that edits code and runs commands.
- Provider configuration for `heital` (Google Gemini), `eternal` (Anthropic
  Claude), and `infernal` (Groq).
- `--doctor` setup checks with no mandatory login.
- A Directioner-owned build, packaging, and release-validation pipeline.
- Prompt-injection, filesystem, and terminal hardening (bounded — see
  [`SECURITY-MODEL.md`](./SECURITY-MODEL.md)).

It is **not** yet:

- A hosted product with account sign-in, device registration, or server-side
  provider credentials.
- A customer `npm install -g` product.
- A driver-repair, privileged-system-administration, or autonomous-execution
  tool.
- Integrated with Aria or Directioner-OS in this repository.

Status labels used across these docs: **AVAILABLE**, **VERIFIED**,
**DEVELOPMENT-ONLY**, **IN DEVELOPMENT**, **DESIGNED**, **PLANNED**, **BLOCKED**.

## How it is installed

The customer installation path is an official Directioner download or installer,
which **does not exist yet**. For the current build see
[`INSTALLATION.md`](./INSTALLATION.md).

## How it is configured

By naming a provider and exporting its API key. See
[`CONFIGURATION.md`](./CONFIGURATION.md).

## What is required to use the current build

A supported platform, a model provider API key you hold, and a project to work
in. No Directioner account and no network path to a Directioner endpoint.

## Security boundaries

See [`SECURITY-MODEL.md`](./SECURITY-MODEL.md). In short: text is never
authority, filesystem containment is logical rather than an OS sandbox, and the
terminal boundary controls the environment and working directory but is not a
filesystem/network sandbox.

## What is planned but not yet available

Directioner-account authentication, the Directioner backend and model gateway,
cloud task/history and synchronization, the website client, Aria integration,
and the Directioner-OS authority bridge. These are **DESIGNED** or **PLANNED**;
the design is captured in [`HOSTED-ARCHITECTURE.md`](./HOSTED-ARCHITECTURE.md),
[`TASK-SESSION-EVENT-MODEL.md`](./TASK-SESSION-EVENT-MODEL.md), and
[`../docs/directioner-production-readiness.md`](./directioner-production-readiness.md).

## How development and testing run

See [`../CONTRIBUTING.md`](../CONTRIBUTING.md),
[`testing.md`](./testing.md), and
[`directioner-release.md`](./directioner-release.md).

## Where to find troubleshooting

[`KNOWN-LIMITATIONS.md`](./KNOWN-LIMITATIONS.md) for current gaps.
