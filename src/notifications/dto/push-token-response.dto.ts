import { ApiProperty } from '@nestjs/swagger';
import { PushPlatform } from './register-push-token.dto';

/** Registered device push token (echoed back on register). */
export class PushTokenDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' })
  token!: string;

  @ApiProperty({ enum: ['ios', 'android'], example: 'ios' })
  platform!: PushPlatform;

  @ApiProperty({ type: String, nullable: true })
  deviceId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

/** Result of deregistering a push token (e.g. on logout). */
export class DeregisterPushTokenResultDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({
    example: 1,
    description: 'How many token rows were removed (0 if it was already gone).',
  })
  removed!: number;
}
