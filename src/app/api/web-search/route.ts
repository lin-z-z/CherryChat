import { getServerConfig } from "@/server/config";
import { handleHostedWebSearch } from "@/server/hosted-web-search";
import { errorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleHostedWebSearch(request, getServerConfig());
  } catch {
    return errorResponse(
      500,
      "CONFIGURATION_ERROR",
      "Server configuration is invalid",
    );
  }
}
