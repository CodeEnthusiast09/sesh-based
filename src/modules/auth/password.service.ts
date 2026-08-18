import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService {
  private readonly options: argon2.HashOptions;

  constructor(private readonly config: ConfigService) {
    this.options = {
      type: argon2.argon2id,
      memoryCost: this.config.getOrThrow<number>('argon2.memoryKib'),
      timeCost: this.config.getOrThrow<number>('argon2.iterations'),
      parallelism: this.config.getOrThrow<number>('argon2.parallelism'),
    };
  }

  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  /**
   * argon2.verify reads the parameters out of the stored hash string, so hashes
   * written under older settings keep verifying after the env values change.
   * Returns false rather than throwing on a malformed hash.
   */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
