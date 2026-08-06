import { RequestSecurityError } from "@/server/security";

export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  detail?: string,
): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
        ...(detail ? { detail } : {}),
      },
    },
    status,
  );
}

export function securityErrorResponse(error: unknown): Response | null {
  if (!(error instanceof RequestSecurityError)) return null;
  return errorResponse(error.status, error.code, error.message);
}
