import { createHmac } from "node:crypto";

import { errorResponse } from "@/server/http";

export const HOSTED_CHAT_CONCURRENCY_LIMIT = 8;
export const HOSTED_WEB_SEARCH_CONCURRENCY_LIMIT = 4;
export const HOSTED_IMAGE_GENERATION_CONCURRENCY_LIMIT = 2;
export const HOSTED_LOGIN_FAILURE_LIMIT = 5;
export const HOSTED_LOGIN_GLOBAL_FAILURE_LIMIT = 100;
export const HOSTED_LOGIN_WINDOW_MS = 60_000;
export const HOSTED_LOGIN_BLOCK_MS = 60_000;
export const HOSTED_LOGIN_CLIENT_CAPACITY = 1024;

export type HostedRequestKind = "chat" | "web-search" | "image-generation";

export interface HostedRequestLease {
  release(): void;
}

export interface HostedRequestGuardOptions {
  chatConcurrencyLimit: number;
  webSearchConcurrencyLimit: number;
  imageGenerationConcurrencyLimit: number;
  loginFailureLimit: number;
  loginGlobalFailureLimit: number;
  loginWindowMs: number;
  loginBlockMs: number;
  loginClientCapacity: number;
  now: () => number;
}

interface LoginFailureBucket {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number;
  lastSeenAt: number;
}

const defaultOptions: HostedRequestGuardOptions = {
  chatConcurrencyLimit: HOSTED_CHAT_CONCURRENCY_LIMIT,
  webSearchConcurrencyLimit: HOSTED_WEB_SEARCH_CONCURRENCY_LIMIT,
  imageGenerationConcurrencyLimit: HOSTED_IMAGE_GENERATION_CONCURRENCY_LIMIT,
  loginFailureLimit: HOSTED_LOGIN_FAILURE_LIMIT,
  loginGlobalFailureLimit: HOSTED_LOGIN_GLOBAL_FAILURE_LIMIT,
  loginWindowMs: HOSTED_LOGIN_WINDOW_MS,
  loginBlockMs: HOSTED_LOGIN_BLOCK_MS,
  loginClientCapacity: HOSTED_LOGIN_CLIENT_CAPACITY,
  now: Date.now,
};

export class HostedRequestGuard {
  private readonly options: HostedRequestGuardOptions;
  private readonly activeRequests: Record<HostedRequestKind, number> = {
    chat: 0,
    "web-search": 0,
    "image-generation": 0,
  };
  private readonly loginClients = new Map<string, LoginFailureBucket>();
  private globalLoginFailures: LoginFailureBucket | null = null;

  constructor(options: Partial<HostedRequestGuardOptions> = {}) {
    this.options = { ...defaultOptions, ...options };
  }

  tryAcquire(kind: HostedRequestKind): HostedRequestLease | null {
    const limit =
      kind === "chat"
        ? this.options.chatConcurrencyLimit
        : kind === "web-search"
          ? this.options.webSearchConcurrencyLimit
          : this.options.imageGenerationConcurrencyLimit;
    if (this.activeRequests[kind] >= limit) return null;

    this.activeRequests[kind] += 1;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.activeRequests[kind] = Math.max(0, this.activeRequests[kind] - 1);
      },
    };
  }

  loginRetryAfterSeconds(request: Request, authSecret: string): number | null {
    const now = this.options.now();
    this.pruneLoginClients(now);
    const clientKey = deriveHostedLoginClientKey(request, authSecret);
    const clientRetry = this.retryAfterSeconds(
      this.loginClients.get(clientKey),
      now,
    );
    const globalRetry = this.retryAfterSeconds(this.globalLoginFailures, now);
    return maximumRetryAfter(clientRetry, globalRetry);
  }

  recordLoginFailure(request: Request, authSecret: string): number | null {
    const now = this.options.now();
    this.pruneLoginClients(now);
    const clientKey = deriveHostedLoginClientKey(request, authSecret);
    const existingClient = this.loginClients.get(clientKey);
    const clientBucket = this.recordFailure(
      existingClient,
      this.options.loginFailureLimit,
      now,
    );
    this.setLoginClient(clientKey, clientBucket);
    this.globalLoginFailures = this.recordFailure(
      this.globalLoginFailures,
      this.options.loginGlobalFailureLimit,
      now,
    );
    return maximumRetryAfter(
      this.retryAfterSeconds(clientBucket, now),
      this.retryAfterSeconds(this.globalLoginFailures, now),
    );
  }

  recordLoginSuccess(request: Request, authSecret: string): void {
    this.loginClients.delete(deriveHostedLoginClientKey(request, authSecret));
  }

  activeCount(kind: HostedRequestKind): number {
    return this.activeRequests[kind];
  }

  loginClientCount(): number {
    return this.loginClients.size;
  }

  reset(): void {
    this.activeRequests.chat = 0;
    this.activeRequests["web-search"] = 0;
    this.activeRequests["image-generation"] = 0;
    this.loginClients.clear();
    this.globalLoginFailures = null;
  }

  private recordFailure(
    existing: LoginFailureBucket | null | undefined,
    limit: number,
    now: number,
  ): LoginFailureBucket {
    const bucket = this.refreshBucket(existing, now);
    if (bucket.blockedUntil > now) {
      bucket.lastSeenAt = now;
      return bucket;
    }
    bucket.failures += 1;
    bucket.lastSeenAt = now;
    if (bucket.failures >= limit) {
      bucket.blockedUntil = now + this.options.loginBlockMs;
    }
    return bucket;
  }

  private retryAfterSeconds(
    existing: LoginFailureBucket | null | undefined,
    now: number,
  ): number | null {
    if (!existing) return null;
    const bucket = this.refreshBucket(existing, now);
    if (bucket.blockedUntil <= now) return null;
    return Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000));
  }

  private refreshBucket(
    existing: LoginFailureBucket | null | undefined,
    now: number,
  ): LoginFailureBucket {
    if (
      !existing ||
      (existing.blockedUntil <= now &&
        now - existing.windowStartedAt >= this.options.loginWindowMs)
    ) {
      return {
        failures: 0,
        windowStartedAt: now,
        blockedUntil: 0,
        lastSeenAt: now,
      };
    }
    return existing;
  }

  private setLoginClient(key: string, bucket: LoginFailureBucket): void {
    if (!this.loginClients.has(key)) {
      while (this.loginClients.size >= this.options.loginClientCapacity) {
        const oldestKey = this.loginClients.keys().next().value as
          string | undefined;
        if (!oldestKey) break;
        this.loginClients.delete(oldestKey);
      }
    } else {
      this.loginClients.delete(key);
    }
    this.loginClients.set(key, bucket);
  }

  private pruneLoginClients(now: number): void {
    const retentionMs = this.options.loginWindowMs + this.options.loginBlockMs;
    for (const [key, bucket] of this.loginClients) {
      if (
        bucket.blockedUntil <= now &&
        now - bucket.lastSeenAt >= retentionMs
      ) {
        this.loginClients.delete(key);
      }
    }
  }
}

export const hostedRequestGuard = new HostedRequestGuard();

export function deriveHostedLoginClientKey(
  request: Request,
  authSecret: string,
): string {
  const address = normalizeHostedLoginAddress(
    request.headers.get("x-vercel-forwarded-for") ??
      request.headers.get("x-forwarded-for") ??
      request.headers.get("x-real-ip") ??
      request.headers.get("cf-connecting-ip") ??
      "unknown",
  );
  return createHmac("sha256", authSecret)
    .update("hosted-login-client")
    .update("\0")
    .update(address)
    .digest("base64url");
}

export function hostedRateLimitResponse(
  code: "AUTH_RATE_LIMITED" | "HOSTED_CONCURRENCY_LIMIT",
  message: string,
  retryAfterSeconds = 1,
): Response {
  const response = errorResponse(429, code, message);
  response.headers.set(
    "Retry-After",
    String(Math.max(1, Math.ceil(retryAfterSeconds))),
  );
  return response;
}

function normalizeHostedLoginAddress(value: string): string {
  const address = (value.split(",", 1)[0] ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim()
    .toLowerCase()
    .slice(0, 256);
  return address || "unknown";
}

function maximumRetryAfter(
  left: number | null,
  right: number | null,
): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}
