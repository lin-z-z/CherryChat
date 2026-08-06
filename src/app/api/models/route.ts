import { getServerConfig } from "@/server/config";
import { errorResponse } from "@/server/http";
import { handleModelsProxy } from "@/server/upstream-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return await handleModelsProxy(request, getServerConfig());
  } catch {
    return errorResponse(
      500,
      "CONFIGURATION_ERROR",
      "Server configuration is invalid",
    );
  }
}
