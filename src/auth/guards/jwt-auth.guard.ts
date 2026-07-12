import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Reusable guard protecting routes with the Passport `jwt` strategy.
 * Other feature modules (mission generation, proof submission, etc.) import this
 * directly: `@UseGuards(JwtAuthGuard)`.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
