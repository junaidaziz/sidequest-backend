import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/**
 * The exact onboarding vocab the mobile OnboardingScreen collects. These four
 * literal sets are the single source of truth for both request validation and
 * the time/budget ceiling maps in MissionsService — keep them in lock-step with
 * mobileApp/src/screens/OnboardingScreen.tsx.
 */
export const CREW_VALUES = ['Solo', 'Partner', 'Friends', 'Family', 'Kids Mode'] as const;
export const TIME_VALUES = ['15 min', '30 min', '1 hour', '2+ hours'] as const;
export const SETTING_VALUES = ['Indoors', 'Outdoors', 'City', 'Nature', 'Anywhere'] as const;
export const BUDGET_VALUES = ['Free', 'Under $10', 'Under $30', 'No limit'] as const;

export type CrewValue = (typeof CREW_VALUES)[number];
export type TimeValue = (typeof TIME_VALUES)[number];
export type SettingValue = (typeof SETTING_VALUES)[number];
export type BudgetValue = (typeof BUDGET_VALUES)[number];

/**
 * The context a user selects during onboarding. Every field is a closed literal
 * set — anything else is a 400 (enforced by @IsIn + the global ValidationPipe's
 * forbidNonWhitelisted).
 */
export class GenerateMissionsDto {
  @ApiProperty({ enum: [...CREW_VALUES], example: 'Solo' })
  @IsIn(CREW_VALUES)
  crew!: CrewValue;

  @ApiProperty({ enum: [...TIME_VALUES], example: '30 min' })
  @IsIn(TIME_VALUES)
  time!: TimeValue;

  @ApiProperty({ enum: [...SETTING_VALUES], example: 'Outdoors' })
  @IsIn(SETTING_VALUES)
  setting!: SettingValue;

  @ApiProperty({ enum: [...BUDGET_VALUES], example: 'Free' })
  @IsIn(BUDGET_VALUES)
  budget!: BudgetValue;
}
