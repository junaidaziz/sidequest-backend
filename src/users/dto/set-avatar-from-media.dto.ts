import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class SetAvatarFromMediaDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'A READY, AVATAR-purpose MediaAsset id owned by the caller (see POST /media/uploads).',
  })
  @IsUUID()
  mediaId!: string;
}
