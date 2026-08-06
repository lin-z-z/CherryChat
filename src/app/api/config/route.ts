import { getServerConfig, toPublicServerConfig } from "@/server/config";
import { hasValidHostedSession } from "@/server/hosted-session";
import { errorResponse, jsonResponse } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const config = getServerConfig();
    const authenticated = hasValidHostedSession(request, config.hosted);
    return jsonResponse({ ...toPublicServerConfig(config), authenticated });
  } catch {
    return errorResponse(
      500,
      "CONFIGURATION_ERROR",
      "Server configuration is invalid",
    );
  }
}
