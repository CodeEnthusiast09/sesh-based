import { IsBoolean, IsEmail, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  // No length rule here on purpose: the policy applies when *setting* a
  // password. Enforcing it at login would tell an attacker which guesses are
  // even worth making, and would lock out users whose password predates it.
  @IsString()
  password: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
