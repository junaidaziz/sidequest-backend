import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

/**
 * True only for a real IANA timezone name (e.g. "America/New_York"). Validated
 * by asking the runtime's own `Intl` database rather than a hand-maintained list:
 * `Intl.DateTimeFormat` throws a RangeError for an unknown zone, so a value that
 * constructs without throwing is one the same `Intl` calls in `streak.util`
 * (`civilDayToUtcMidnight`) will accept — keeping the write-time check and the
 * read-time computation in lockstep. Non-strings and the empty string are
 * rejected here (streak math falls back to UTC only for an *unset* timezone,
 * never a client-supplied bad one).
 */
export function isIanaTimeZone(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }
  try {
    // Throws RangeError on an unrecognized IANA zone; succeeds otherwise.
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Reusable class-validator decorator enforcing a valid IANA timezone name. */
export function IsIanaTimeZone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isIanaTimeZone',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return isIanaTimeZone(value);
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a valid IANA timezone name (e.g. "America/New_York")`;
        },
      },
    });
  };
}
