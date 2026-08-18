import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';

import {
  SESSION_STORE,
  type SessionStore,
} from './stores/session-store.interface';

const INTERVAL_NAME = 'session-cleanup';

/**
 * Expired sessions are already invisible to reads, since every query checks both
 * clocks. This only stops the table growing forever. The interval is registered
 * dynamically rather than with @Interval because the period comes from env, and
 * decorator arguments are fixed at import time.
 */
@Injectable()
export class SessionCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionCleanupService.name);

  constructor(
    @Inject(SESSION_STORE) private readonly store: SessionStore,
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const seconds = this.config.getOrThrow<number>(
      'session.cleanupIntervalSeconds',
    );

    this.scheduler.addInterval(
      INTERVAL_NAME,
      setInterval(() => void this.sweep(), seconds * 1000),
    );
  }

  onModuleDestroy(): void {
    if (this.scheduler.doesExist('interval', INTERVAL_NAME)) {
      this.scheduler.deleteInterval(INTERVAL_NAME);
    }
  }

  /**
   * Public so tests can drive it directly instead of waiting for the timer.
   * Safe to run concurrently across instances: deleting an already-deleted row
   * is a no-op, so no coordination is needed.
   */
  async sweep(): Promise<number> {
    try {
      const removed = await this.store.deleteExpired();

      if (removed > 0) {
        this.logger.log(`Removed ${removed} expired session(s)`);
      }

      return removed;
    } catch (error) {
      // A failed sweep must never take the process down; the next tick retries.
      this.logger.error(
        `Session cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      return 0;
    }
  }
}
