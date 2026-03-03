import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

type PluginRuntime = OpenClawPluginApi["runtime"];

let botlinkRuntime: PluginRuntime | null = null;

export function setBotlinkRuntime(runtime: PluginRuntime) {
  botlinkRuntime = runtime;
}

export function getBotlinkRuntime(): PluginRuntime {
  if (!botlinkRuntime) {
    throw new Error("Botlink runtime not initialized.");
  }
  return botlinkRuntime;
}
