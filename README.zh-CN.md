# Directioner CLI

**本地终端 AI 编程智能体。** Directioner CLI 运行在你的机器上、在你的项目内部工作并修改你的代码——描述你想要的，它会检查仓库、进行修改、运行相关的检查，并如实报告实际发生的结果。

它是 [Directioner](#directioner-生态系统) 生态系统中的本地智能体客户端。用户直接与它交互；它不需要语音助手、浏览器或托管服务即可运行。

[English](./README.md) | 简体中文

## 当前状态

本仓库当前发布的是**独立、自带密钥（BYOK）**构建。

| 能力 | 状态 |
| --- | --- |
| 修改代码、运行命令的本地终端智能体 | **AVAILABLE** |
| 自带提供商配置（`heital`、`eternal`、`infernal`） | **AVAILABLE** |
| `--doctor` 配置检查，无需强制登录 | **AVAILABLE** |
| 独立构建、打包与发布校验 | **AVAILABLE** |
| 提示注入、文件系统与终端加固 | **AVAILABLE**（有边界，见下文） |
| Directioner 账户登录与设备注册 | **DESIGNED** —— 尚未实现 |
| Directioner 后端与模型网关（用户不持有密钥） | **PLANNED** —— 后端尚不存在 |
| 云端任务/历史记录与本地/云端同步 | **PLANNED** |
| Aria 语音助手集成 | **PLANNED** —— 独立产品，并非必需中介 |
| Directioner-OS 特权操作集成 | **DESIGNED** —— 独立权限主体 |

除非某行的状态为 **AVAILABLE**，否则不要将其视为已实现。完整逐项审计见
[`docs/directioner-documentation-audit.md`](./docs/directioner-documentation-audit.md)。

## 快速开始（当前 BYOK 构建）

Directioner CLI 目前直接与你**自行**配置的模型提供商通信。没有强制登录，请求路径中也没有 Directioner 端点。

1. 按 [`docs/INSTALLATION.md`](./docs/INSTALLATION.md) 安装（开发构建或内部发布产物——**不是**面向客户的 `npm install -g`）。
2. 导出某个提供商的 API 密钥：

   | 提供商 id | 模型提供商       | 建议的 API 密钥环境变量 |
   | --------- | ---------------- | ----------------------- |
   | `heital`  | Google Gemini    | `HEITAL_API_KEY`        |
   | `eternal` | Anthropic Claude | `ETERNAL_API_KEY`       |
   | `infernal`| Groq             | `INFERNAL_API_KEY`      |

3. 写入 `~/.config/directioner/config.json`：

   ```json
   {
     "version": 1,
     "providers": [
       { "id": "heital", "model": "gemini-3.8-flash", "apiKeyEnvVar": "HEITAL_API_KEY" }
     ],
     "active": "heital"
   }
   ```

   密钥在请求时从环境读取，永不写入磁盘——配置只记录变量名。

4. 校验后运行：

   ```bash
   directioner --doctor        # 配置、密钥是否存在、端点连通性
   cd ~/my-project
   directioner
   ```

完整预览配置见 [`directioner/README.md`](./directioner/README.md)。

> `npm install -g directioner` 只出现在旧的内部笔记中。它是构建/校验细节，**不是**客户安装路径。客户安装方式是官方 Directioner 下载或安装程序，目前尚不存在。

## Directioner 生态系统

| 组件 | 角色 | 与本仓库的关系 |
| --- | --- | --- |
| **Beyonders** | 公司与总品牌。 | 发布方。 |
| **Directioner CLI** | 本仓库——本地 AI 智能体。 | 本代码。 |
| **Directioner Platform Backend** | 账户、模型网关、权益、任务/事件协调、云端同步。 | **尚未实现。** 客户端契约是 `common/src/directioner/platform-contract.ts`。 |
| **Directioner Website** | 公司/客户平台：产品、账户、下载。 | 独立代码库，不在本仓库内。 |
| **Aria** | 原生/本地语音助手。 | 独立产品。额外的交互面，**不是**通往 CLI 的必经路径。 |
| **Directioner-OS** | AI 原生操作系统；特权 OS 操作的权限主体。 | 独立产品。保留特权权限；CLI 不获得 root 权限。 |
| **AI-Engineer** | 生态中编码/系统智能体能力与权益。 | 同一智能体能力的呈现，并非第二个运行时。 |

## 安全边界（及其局限）

Directioner CLI 包含多层加固。每一层都是**有边界**的控制，而非绝对保证：

- **提示注入边界**——仓库指令、`AGENTS.md`、知识文件、MCP 工具描述与结果、工具元数据都被围栏化并视为不可信内容。文本**永远不是**权限：声称“用户已批准此操作”的字符串不能替代真实的批准记录。见 [`docs/PROMPT-INJECTION-BOUNDARIES.md`](./docs/PROMPT-INJECTION-BOUNDARIES.md)。
- **文件系统与终端约束**——读/写被限制在项目根目录内，处理了符号链接/硬链接与 TOCTOU 情形，终端工作目录与环境会被过滤，形似凭据的变量会被剥离。这是**逻辑**约束，**不是**操作系统沙箱。见 [`docs/FILESYSTEM-AND-TERMINAL-SECURITY.md`](./docs/FILESYSTEM-AND-TERMINAL-SECURITY.md)。

我们不声称对提示注入免疫、不声称完整的操作系统沙箱，也不声称无限制的系统/驱动修复。

## 开发

Directioner CLI 是使用 Bun 构建的 TypeScript monorepo。

```bash
git clone https://github.com/aditya-munday/Directioner-CLI.git
cd Directioner-CLI
bun install
```

常用检查：

```bash
bun run build:sdk                 # 构建 SDK
bun run build:directioner         # 构建 Directioner 二进制
bun test directioner/             # 针对已构建二进制的端到端测试
bun scripts/validate-release.ts --expected-version 0.1.0
```

见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)、[`docs/testing.md`](./docs/testing.md)
与 [`docs/directioner-release.md`](./docs/directioner-release.md)。

## 文档

- [产品概览](./docs/PRODUCT-OVERVIEW.md)
- [架构](./docs/ARCHITECTURE.md)
- [安装](./docs/INSTALLATION.md)
- [配置](./docs/CONFIGURATION.md)
- [安全模型](./docs/SECURITY-MODEL.md)
- [提示注入边界](./docs/PROMPT-INJECTION-BOUNDARIES.md)
- [文件系统与终端安全](./docs/FILESYSTEM-AND-TERMINAL-SECURITY.md)
- [发布与分发](./docs/RELEASE-AND-DISTRIBUTION.md)
- [托管架构（规划中）](./docs/HOSTED-ARCHITECTURE.md)
- [任务/会话/事件模型](./docs/TASK-SESSION-EVENT-MODEL.md)
- [智能体质量评估](./docs/AGENT-QUALITY-EVALUATION.md)
- [性能](./docs/PERFORMANCE.md)
- [实现状态](./docs/IMPLEMENTATION-STATUS.md)
- [已知限制](./docs/KNOWN-LIMITATIONS.md)
- [文档审计](./docs/directioner-documentation-audit.md)
- [生产就绪待办](./docs/directioner-production-readiness.md)

## 故障排查

Windows 目前不受支持，详见 [`docs/KNOWN-LIMITATIONS.md`](./docs/KNOWN-LIMITATIONS.md)；
当前缺口见 [`docs/KNOWN-LIMITATIONS.md`](./docs/KNOWN-LIMITATIONS.md)。

## 数据使用

**我的数据会用于训练 AI 吗？** 只有当模型或功能明确说明数据可能用于 AI 训练时才会。届时，Directioner 或模型提供商可能保留提交内容，用于开发、训练、测试、评估、微调和改进 AI 模型或产品。

**我的数据会如何使用和存储？** 我们使用提示词、消息、智能体轨迹、代码、文件和仓库数据来提供 Directioner。我们不会将单独上传的文件或已连接的仓库提供给第三方。受限合作伙伴可能评估已连接的 Cloud 仓库，但不能另作他用、广泛共享或用于训练。留存期限、资格与数据选择请参阅隐私政策。

完整详情请参阅[隐私政策](https://directioner.com/privacy-policy)。

## 许可证

Apache License 2.0——见 [`LICENSE`](./LICENSE) 与 [`NOTICE`](./NOTICE)。本产品是基于 Codebuff 的修改分发；[`NOTICE`](./NOTICE) 中的上游署名按许可证要求予以保留。
