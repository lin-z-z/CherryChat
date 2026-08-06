import { getServerConfig } from "@/server/config";
import { errorResponse } from "@/server/http";
import { handleChatProxy } from "@/server/upstream-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleChatProxy(request, getServerConfig());
  } catch {
    return errorResponse(
      500,
      "CONFIGURATION_ERROR",
      "Server configuration is invalid",
    );
  }
}
