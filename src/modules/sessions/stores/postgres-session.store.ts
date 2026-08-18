import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SessionEntity } from '../entities/session.entity';
import { SessionRecord } from '../session.types';
import { SessionStore } from './session-store.interface';

@Injectable()
export class PostgresSessionStore implements SessionStore {
  constructor(
    @InjectRepository(SessionEntity)
    private readonly sessions: Repository<SessionEntity>,
  ) {}

  async create(record: SessionRecord): Promise<void> {
    await this.sessions.insert(record);
  }

  async findById(id: string): Promise<SessionRecord | null> {
    const found = await this.liveSessions()
      .andWhere('session.id = :id', { id })
      .getOne();

    return found;
  }

  async touch(
    id: string,
    lastSeenAt: Date,
    idleExpiresAt: Date,
  ): Promise<void> {
    await this.sessions.update({ id }, { lastSeenAt, idleExpiresAt });
  }

  async delete(id: string): Promise<void> {
    await this.sessions.delete({ id });
  }

  async deleteByUser(userId: string, exceptId?: string): Promise<number> {
    // Built with the query builder because TypeORM 1.x throws on an undefined
    // value inside a where object, rather than ignoring it as 0.3.x did.
    const query = this.sessions
      .createQueryBuilder()
      .delete()
      .where('user_id = :userId', { userId });

    if (exceptId !== undefined) {
      query.andWhere('id != :exceptId', { exceptId });
    }

    const result = await query.execute();

    return result.affected ?? 0;
  }

  async listByUser(userId: string): Promise<SessionRecord[]> {
    return this.liveSessions()
      .andWhere('session.userId = :userId', { userId })
      .orderBy('session.lastSeenAt', 'DESC')
      .getMany();
  }

  async deleteExpired(): Promise<number> {
    const result = await this.sessions
      .createQueryBuilder()
      .delete()
      .where('idle_expires_at <= :now', { now: new Date() })
      .orWhere('absolute_expires_at <= :now', { now: new Date() })
      .execute();

    return result.affected ?? 0;
  }

  /** Both clocks are checked on every read, so expired rows are never returned. */
  private liveSessions() {
    const now = new Date();

    return this.sessions
      .createQueryBuilder('session')
      .where('session.idleExpiresAt > :now', { now })
      .andWhere('session.absoluteExpiresAt > :now', { now });
  }
}
