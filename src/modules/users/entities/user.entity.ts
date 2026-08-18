import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Stored lowercased so uniqueness is case-insensitive without the citext extension. */
  @Index({ unique: true })
  @Column({ type: 'text' })
  email: string;

  /**
   * select: false keeps the hash out of every query that does not explicitly ask
   * for it, so it cannot leak into a response by accident. Login opts back in
   * with addSelect().
   */
  @Column({ name: 'password_hash', type: 'text', select: false })
  passwordHash: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
