import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';

@Entity('sessions')
export class SessionEntity {
  /** SHA-256 hex of the raw session ID. The raw value is never stored. */
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'csrf_token', type: 'text' })
  csrfToken: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt: Date;

  @Index()
  @Column({ name: 'idle_expires_at', type: 'timestamptz' })
  idleExpiresAt: Date;

  @Column({ name: 'absolute_expires_at', type: 'timestamptz' })
  absoluteExpiresAt: Date;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string | null;

  @Column({ name: 'ip', type: 'text', nullable: true })
  ip: string | null;

  @Column({ name: 'remember_me', type: 'boolean', default: false })
  rememberMe: boolean;
}
