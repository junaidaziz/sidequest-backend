import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ContactService } from './contact.service';
import { ContactSubmissionAckDto } from './dto/contact-submission-response.dto';
import { CreateContactSubmissionDto } from './dto/create-contact-submission.dto';

/**
 * Tight per-IP cap for a public, unauthenticated, email-triggering form — 5/60s,
 * matching the sensitive-endpoint tier used on auth routes. Prevents both
 * submission spam and notification-email flooding.
 */
const CONTACT_THROTTLE = { default: { limit: 5, ttl: 60_000 } } as const;

/**
 * Public marketing-site contact form intake. Unauthenticated by design (the
 * marketing site has no user session), rate-limited, and validated via DTO. All
 * logic (persist + best-effort notification email) lives in ContactService.
 */
@ApiTags('contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly service: ContactService) {}

  @Post()
  @Throttle(CONTACT_THROTTLE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit the public contact form' })
  @ApiResponse({ status: 201, type: ContactSubmissionAckDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  submit(@Body() dto: CreateContactSubmissionDto): Promise<ContactSubmissionAckDto> {
    return this.service.submit(dto);
  }
}
