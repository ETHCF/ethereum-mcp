// Security utilities

// Strip sensitive data from error messages
export function sanitizeError(error: unknown, sensitiveKeys: string[] = []): string {
  let message = error instanceof Error ? error.message : String(error);

  // Remove any API keys that might be in the message
  for (const key of sensitiveKeys) {
    if (key && key.length > 8) {
      message = message.replace(new RegExp(key, 'g'), '[REDACTED]');
    }
  }

  // Remove anything that looks like an API key (32+ char hex)
  message = message.replace(/[a-fA-F0-9]{32,}/g, '[REDACTED]');

  return message;
}

// Rate limiting helper
export class RateLimiter {
  private requests: number[] = [];
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  canMakeRequest(): boolean {
    const now = Date.now();
    this.requests = this.requests.filter((t) => now - t < this.windowMs);
    return this.requests.length < this.maxRequests;
  }

  recordRequest(): void {
    this.requests.push(Date.now());
  }

  async waitForSlot(): Promise<void> {
    while (!this.canMakeRequest()) {
      await new Promise((r) => setTimeout(r, 100));
    }
    this.recordRequest();
  }
}
