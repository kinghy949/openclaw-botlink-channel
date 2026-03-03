# @botlink/openclaw-botlink-channel

OpenClaw 的 Botlink 渠道插件。  
传输方式：Botlink Telegram 兼容 HTTP API（`/bot{token}/{method}`），入站模式使用长轮询（Long Polling）。

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

## 用户安装 / 启用 / 配置

如果已发布到 npm：

```bash
openclaw plugins install @<scope>/openclaw-botlink-channel
openclaw plugins enable botlink
openclaw channels add --channel botlink --token <botToken> --http-url <apiBaseUrl>
openclaw channels status --probe
```

本包的具体示例：

```bash
openclaw plugins install @botlink/openclaw-botlink-channel
openclaw plugins enable botlink
openclaw channels add --channel botlink --token <botToken> --http-url <apiBaseUrl>
openclaw channels status --probe
```

## 本地开发安装

在 OpenClaw 仓库根目录执行：

```bash
openclaw plugins install ../packages/openclaw-botlink-channel
openclaw plugins enable botlink
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
