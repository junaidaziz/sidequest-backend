import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Device platforms a push token can belong to. */
export const PUSH_PLATFORMS = ['ios', 'android'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** Body for `POST /notifications/push-tokens` — register/upsert a device token. */
export class RegisterPushTokenDto {
  @ApiProperty({
    example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
    description: 'The device push token issued by the client (e.g. an Expo push token).',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  token!: string;

  @ApiProperty({ enum: PUSH_PLATFORMS, example: 'ios' })
  @IsIn(PUSH_PLATFORMS)
  platform!: PushPlatform;

  @ApiProperty({
    required: false,
    nullable: true,
    example: 'e2b9-....',
    description: 'Optional stable device identifier, if the client can provide one.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceId?: string;
}
