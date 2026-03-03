import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { botlinkPlugin } from "./src/channel.js";
import { setBotlinkRuntime } from "./src/runtime.js";

const plugin = {
  id: "botlink",
  name: "Botlink",
  description: "Botlink channel plugin (Telegram-compatible HTTP long polling)",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setBotlinkRuntime(api.runtime);
    api.registerChannel({ plugin: botlinkPlugin });
  },
};

export default plugin;
