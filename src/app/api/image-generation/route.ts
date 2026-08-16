import { getServerConfig } from "@/server/config";
import { handleHostedImageGeneration } from "@/server/hosted-image-generation";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleHostedImageGeneration(request, getServerConfig());
}
