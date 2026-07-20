import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Cross-field range/conflict checks for `CampaignTargetFilterDto` (backend-eval
 * B1-WARN, Phase 11 review): without these, an inverted range (e.g.
 * `minTotalXp > maxTotalXp`) or a self-contradictory combination
 * (`activeSince` + `inactiveSince` both set) silently resolves to a 0-user
 * audience instead of a 400 — `previewAudience` surfaces the empty count, but
 * nothing tells the admin *why* it's empty. These decorators turn that into an
 * explicit validation error at request time.
 */

@ValidatorConstraint({ name: 'isGreaterOrEqualToField', async: false })
class IsGreaterOrEqualToFieldConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (value === undefined || value === null) return true;
    const [otherProperty] = args.constraints as [string];
    const other = (args.object as Record<string, unknown>)[otherProperty];
    if (other === undefined || other === null) return true;

    if (typeof value === 'number' && typeof other === 'number') {
      return value >= other;
    }
    // Both fields are validated elsewhere as ISO-8601 strings; compare as dates.
    const valueMs = new Date(value as string).getTime();
    const otherMs = new Date(other as string).getTime();
    if (Number.isNaN(valueMs) || Number.isNaN(otherMs)) return true; // let @IsISO8601 report it
    return valueMs >= otherMs;
  }

  defaultMessage(args: ValidationArguments): string {
    const [otherProperty] = args.constraints as [string];
    return `${args.property} must be greater than or equal to ${otherProperty}`;
  }
}

/** `value >= the named sibling field` (numbers compared numerically, strings as dates). */
export function IsGreaterOrEqualToField(
  property: string,
  options?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isGreaterOrEqualToField',
      target: object.constructor,
      propertyName: propertyName as string,
      constraints: [property],
      options,
      validator: IsGreaterOrEqualToFieldConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'isNotSetWithField', async: false })
class IsNotSetWithFieldConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (value === undefined || value === null) return true;
    const [otherProperty] = args.constraints as [string];
    const other = (args.object as Record<string, unknown>)[otherProperty];
    return other === undefined || other === null;
  }

  defaultMessage(args: ValidationArguments): string {
    const [otherProperty] = args.constraints as [string];
    return `${args.property} and ${otherProperty} are contradictory and cannot both be set`;
  }
}

/** Rejects the request if both this field and the named sibling field are set. */
export function IsNotSetWithField(
  property: string,
  options?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isNotSetWithField',
      target: object.constructor,
      propertyName: propertyName as string,
      constraints: [property],
      options,
      validator: IsNotSetWithFieldConstraint,
    });
  };
}
