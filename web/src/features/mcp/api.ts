import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface McpToolInfo {
  name: string;
  prefixedName: string;
  description: string;
  inputSchema: unknown;
}

export interface McpServerStatus {
  name: string;
  transport: string;
  source: string;
  configured: boolean;
  healthy: boolean;
  error?: string | null;
  toolCount: number;
  tools: McpToolInfo[];
}

interface McpServersResponse {
  servers: McpServerStatus[];
}

export function useMcpServers() {
  return useQuery({
    queryKey: ["mcp", "servers"],
    queryFn: () => api.get<McpServersResponse>("/mcp/servers"),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
