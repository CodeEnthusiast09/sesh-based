import {
  isIP,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

/**
 * class-validator ships isIP but nothing for CIDR, so the prefix is checked
 * here: split once on "/", validate the address, then bound the prefix length
 * by the address family (32 bits for IPv4, 128 for IPv6).
 */
const isValidEntry = (entry: string): boolean => {
  const [address, prefix, ...rest] = entry.split('/');

  if (rest.length > 0 || !isIP(address)) {
    return false;
  }

  if (prefix === undefined) {
    return true;
  }

  const bits = Number(prefix);
  const maxBits = isIP(address, 4) ? 32 : 128;

  return (
    /^\d+$/.test(prefix) &&
    Number.isInteger(bits) &&
    bits >= 0 &&
    bits <= maxBits
  );
};

/**
 * Validates a comma-separated list of IP addresses and CIDR blocks.
 *
 * Used for TRUSTED_PROXIES, where a typo has to fail the boot rather than pass
 * silently: an entry Express cannot parse is simply not trusted, so the mistake
 * would only show up later as every client sharing one rate limit bucket.
 */
@ValidatorConstraint({ name: 'isCidrList', async: false })
class IsCidrListConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || value.trim() === '') {
      return true;
    }

    return splitList(value).every(isValidEntry);
  }

  defaultMessage(args: ValidationArguments): string {
    const invalid = splitList(String(args.value)).filter(
      (entry) => !isValidEntry(entry),
    );

    return `${args.property} entries must be IP addresses or CIDR blocks, got: ${invalid.join(', ')}`;
  }
}

export const IsCidrList =
  (validationOptions?: ValidationOptions) =>
  (object: object, propertyName: string): void => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsCidrListConstraint,
    });
  };
