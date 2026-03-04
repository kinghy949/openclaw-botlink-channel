# @botlink/openclaw-botlink-channel

OpenClaw 的 Botlink 渠道插件。  
传输方式：Botlink Telegram 兼容 HTTP API（`/bot{token}/{method}`），入站模式使用长轮询（Long Polling）。

## 环境要求

- Node.js 20+
- OpenClaw CLI（建议 `2026.3.x` 或更新版本）

## 功能（v0.1）

- 文本消息收发
- 媒体消息收发
- 消息编辑/删除动作
- 消息反应动作

## 必需的 OpenClaw 渠道配置

`channels.botlink` 需要：

- `botToken`（必填）
- `apiBaseUrl`（必填，无默认值）

示例：

```jsonc
{
  "channels": {
    "botlink": {
      "enabled": true,
      "botToken": "<botToken>",
      "apiBaseUrl": "https://botlink-gateway.example.com"
    }
  }
}
```

## 从 Git 拉取后本地可直接使用（推荐）

1. 克隆仓库并进入目录：

```bash
git clone <your-repo-url>
cd openclaw-botlink-channel
```

2. 安装并启用插件（`openclaw-botlink-channel` 是插件 ID，`botlink` 是渠道 ID）：

```bash
openclaw plugins install .
openclaw plugins enable openclaw-botlink-channel
```

3. 添加 Botlink 渠道账号并检查状态：

```bash
openclaw channels add --channel botlink --token <botToken> --http-url <apiBaseUrl>
openclaw channels status
```

4. 可选：探测远端连通性（需要网关运行且凭据有效）：

```bash
openclaw channels status --probe --timeout 10000
```

## 本地开发（可选）

如果你在调试插件代码并希望直接引用工作区源码（不复制到 OpenClaw 扩展目录）：

```bash
npm install
openclaw plugins install . --link
openclaw plugins enable openclaw-botlink-channel
```

## 通过 npm 安装 / 启用 / 配置

如果包已发布：

```bash
openclaw plugins install @<scope>/openclaw-botlink-channel
openclaw plugins enable openclaw-botlink-channel
openclaw channels add --channel botlink --token <botToken> --http-url <apiBaseUrl>
openclaw channels status --probe --timeout 10000
```

本包示例：

```bash
openclaw plugins install @botlink/openclaw-botlink-channel
openclaw plugins enable openclaw-botlink-channel
openclaw channels add --channel botlink --token <botToken> --http-url <apiBaseUrl>
openclaw channels status --probe --timeout 10000
```

## 发布（npm）

该插件提供 TypeScript 入口，并使用 `openclaw.extensions = ["./index.ts"]`。

1. 更新 `package.json` 中的版本号。
2. 打包测试：

```bash
npm pack
```

3. 发布：

```bash
npm publish --access public
```

4. 通过 npm 包名进行安装测试：

```bash
openclaw plugins install @<scope>/openclaw-botlink-channel
```
