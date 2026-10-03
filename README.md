# Directioner

English | [简体中文](./README.zh-CN.md)

**Five free AI products for coding, building, and research.** No subscription, credits, or API key required.

[Directioner](https://directioner.com) brings specialized agents and a choice of leading models to your terminal, desktop, browser, and GitHub repositories. Text ads support access to the included models.

## Choose your Directioner

| Product              | What it does                        | Get started                                                           |
| -------------------- | ----------------------------------- | --------------------------------------------------------------------- |
| **Directioner Desktop** | Run parallel agents locally         | [Download for macOS, Windows, or Linux](https://directioner.com/desktop) |
| **Directioner CLI**     | Code from your terminal             | [Install the CLI](https://directioner.com/cli)                           |
| **Directioner Web**     | Build and ship full-stack apps      | [Build an app](https://directioner.com/web)                              |
| **Directioner Cloud**   | Run agents on any GitHub repository | [Connect a repository](https://directioner.com/cloud)                    |
| **Directioner Chat**    | Research and think with AI          | [Start a chat](https://directioner.com/chat)                             |

## Quick start

Directioner is a locally installed application that runs against your
Directioner account:

1. Create or sign in to your [Directioner account](https://directioner.com).
2. Install the official Directioner application for your platform.
3. Authenticate and register this device.
4. Open Directioner in any project from your terminal and describe what you want.

```bash
cd ~/my-project
directioner
```

Directioner finds the relevant files, makes changes, and runs the checks that
matter for your project. You do not configure a model provider key — Directioner
runs against Directioner-owned model services.

> **Status.** The hosted account backend is still being built. Until it ships,
> the terminal agent is available as a **developer preview** that runs directly
> against a model provider you configure yourself; see
> [`directioner/README.md`](./directioner/README.md) for the preview setup.

## Models

Directioner includes a curated model catalog. The regular picker currently offers:

| Model                       | Access                  | Best for                                                          |
| --------------------------- | ----------------------- | ----------------------------------------------------------------- |
| **GLM 5.3 Flash**           | Full and limited access | The default everywhere; deepest reasoning, unmetered              |
| **DeepSeek V4.1 Flash** | Full and limited access | Fast coding and tool use, unmetered                               |
| **GPT-6 Luna**              | Full access             | Strong all-around with native images; runs on OpenAI flex capacity |
| **MiMo 2.6 Flash**          | Full and limited access | Balanced performance with image support                           |
| **MiMo 2.6 Pro**            | Full access             | Xiaomi's stronger reasoning model, with image support |
| **Solar Mini 4**            | Full and limited access | Upstage's fast, compact model; 524K context, text only |
| **Solar Pro 4**             | Full and limited access | Upstage's larger, stronger model; 524K context, text only |
| **Space Bunny Alpha**       | Full access             | Beta. A stealth model from an anonymous provider that retains prompts; 1M context, images |
| **Gemini 3.8 Flash**        | Paid plans              | 1M context, and the only model that accepts audio, video and PDF |
| **Muse Spark 1.2**          | Full access             | Meta's agentic coding model; 1M context. Rate limited and shared by every user, so it queues when busy and answers on DeepSeek V4 Flash rather than making you wait |

Most models draw on your normal daily sessions rather than a separate limit. GLM 5.3 Flash, DeepSeek V4.1 Flash, MiMo 2.6 Flash, Solar Mini 4 and Solar Pro 4 are unmetered at full access and cost no session at all. Models may still serve from a quantized (Q8_0) build.

DeepSeek V4 Pro was retired from the catalog; GLM 5.3 Flash replaces it as the deep-reasoning pick.

Beyond the regular picker:

- **Referrals and bounties** earn extra sessions on top of the free daily allowance.
- **Gemini 3.1 Flash Lite** powers specialist tasks such as file finding and research rather than appearing in the main picker.

Availability and limits depend on your access tier, product, and current capacity. Directioner Desktop can also run locally installed Claude Code and Codex agents using your existing provider account; those connected models are separate from Directioner's included catalog.

## How Directioner works

Directioner uses specialized agents instead of sending every task through one model and one prompt. Depending on the task, agents gather context, plan, edit or research, run tools, and review the result.

- **Codebase context** — File-finding agents map the relevant parts of a project before editing.
- **Implementation and review** — Agents can divide work, make changes, run commands, and inspect the result.
- **Research and browser use** — Agents can investigate documentation and test applications in a real browser.
- **Parallel local work** — Desktop isolates concurrent agents in separate workspaces.
- **Hosted environments** — Web and Cloud provide sandboxes, previews, terminals, and deployment workflows.

## Free access

Directioner is available in every country. Supported regions receive full access; other regions and VPN users receive limited access to GLM 5.3 Flash, DeepSeek V4.1 Flash, MiMo 2.6 Flash, Solar Mini 4, and Solar Pro 4. Accounts on Freebucks use the displayed model price and balance. On the legacy session system, limited access includes six one-hour sessions per day, earnable up to seven; GLM uses earned reward sessions instead.

Text ads support the included models. Directioner shows the applicable session limits and any model-specific data-use notice before you start.

<!-- BEGIN GENERATED DIRECTIONER DATA USE -->

**Is my data used to train AI?** Only when a model or feature says data may be used for AI training. Directioner or the provider may then keep submissions to develop, train, test, evaluate, fine-tune, and improve AI models or products.

**How is my data used and stored?** We use prompts, messages, agent traces, code, files, and repository data to provide Directioner. We do not give separately uploaded files or connected repositories to third parties. Restricted partners may evaluate connected Cloud repositories, but cannot otherwise use, broadly share, or train on them. See the Privacy Policy for retention, eligibility, and data choices.

See the [Privacy Policy](https://directioner.com/privacy-policy) for complete details.

<!-- END GENERATED DIRECTIONER DATA USE -->

## Contributing

Directioner is a TypeScript monorepo built with Bun. Contributions to the products, agents, tools, documentation, and underlying runtime are welcome.

Local development requires Docker and a configured `.env.local`; see the
[Contributing Guide](./CONTRIBUTING.md) before starting the services.

```bash
git clone https://github.com/BeyondersAI/directioner.git
cd directioner
bun install
bun up
```

Start the CLI separately with:

```bash
bun start-cli
```

See the [Contributing Guide](./CONTRIBUTING.md), [development guide](./docs/development.md), and [testing guide](./docs/testing.md) for environment setup and the checks to run before opening a pull request.

## Built on Beyonders

Directioner is built on [Beyonders](https://beyonders.com), the open multi-agent framework that powers its orchestration, tools, and SDK. To create custom agents or embed them in another application, see the [Beyonders documentation](https://beyonders.com/docs) and [`@beyonders/sdk`](https://www.npmjs.com/package/@beyonders/sdk).

## Links

- [Website](https://directioner.com)
- [GitHub](https://github.com/BeyondersAI/directioner)
- [Discord](https://discord.gg/yXG3w7wxfs)
- [Privacy Policy](https://directioner.com/privacy-policy)
- [License](./LICENSE)
