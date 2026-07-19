import { CAPABILITIES, type Capability, type EffectiveTool } from "./types.ts";

export interface EffectiveCapabilities {
  tools: EffectiveTool[];
  extensions: string[];
  env: Record<string, string>;
}

type CapabilityGrant = {
  tools: readonly EffectiveTool[];
  extensions?: readonly string[];
  env?: Readonly<Record<string, string>>;
};

export const CAPABILITY_GRANTS: Readonly<Record<Capability, CapabilityGrant>> =
  {
    "read-filesystem": {
      tools: ["read", "ls", "find", "grep"],
    },
    "exec-shell": {
      tools: ["bash"],
    },
    "read-broker": {
      tools: ["mcp_search", "mcp_describe", "mcp_call", "read"],
      extensions: ["mcp-broker"],
      env: {
        MCP_BROKER_READONLY: "1",
        MCP_BROKER_APPROVAL_MODE: "reject",
      },
    },
    "read-web": {
      tools: ["web_search", "web_fetch", "read"],
      extensions: ["web-access"],
    },
  };

export function resolveCapabilities(
  requested: readonly Capability[],
): EffectiveCapabilities {
  const tools: EffectiveTool[] = [];
  const extensions: string[] = [];
  const env: Record<string, string> = {};
  const seenTools = new Set<EffectiveTool>();
  const seenExtensions = new Set<string>();

  for (const capability of CAPABILITIES) {
    if (!requested.includes(capability)) continue;
    const grant = CAPABILITY_GRANTS[capability];
    for (const tool of grant.tools) {
      if (!seenTools.has(tool)) {
        seenTools.add(tool);
        tools.push(tool);
      }
    }
    for (const extension of grant.extensions ?? []) {
      if (!seenExtensions.has(extension)) {
        seenExtensions.add(extension);
        extensions.push(extension);
      }
    }
    Object.assign(env, grant.env);
  }

  return { tools, extensions, env };
}
