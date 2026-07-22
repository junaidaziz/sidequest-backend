import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AdminUser, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminCryptoService } from './admin-crypto.service';
import { AdminMfaSetupResponseDto } from './dto/admin-mfa-response.dto';
import { buildOtpAuthUrl, generateTotpSecret, verifyTotp } from './totp/totp.util';

const BCRYPT_ROUNDS = 12;
const RECOVERY_CODE_COUNT = 10;
const TOTP_ISSUER = 'SideQuest Admin';

/**
 * TOTP + recovery-code MFA for admins (no SMS). The TOTP secret is stored
 * AES-256-GCM-encrypted (never plaintext); recovery codes are stored one-per-row,
 * each individually bcrypt-hashed and consumable exactly once (replay-proof).
 */
@Injectable()
export class AdminMfaService {
  private readonly logger = new Logger(AdminMfaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AdminCryptoService,
  ) {}

  /**
   * Generates a fresh TOTP secret for an authenticated admin and stores it
   * encrypted. Does NOT enable MFA yet — enrollment completes only after the
   * first code is confirmed via verify(). Blocks if MFA is already active (the
   * admin must reset-mfa first).
   */
  async setup(admin: AdminUser, tx?: Prisma.TransactionClient): Promise<AdminMfaSetupResponseDto> {
    if (admin.mfaEnabledAt) {
      throw new ConflictException('MFA is already enabled; reset it before setting up again');
    }
    const secret = generateTotpSecret();
    await (tx ?? this.prisma).adminUser.update({
      where: { id: admin.id },
      data: { mfaSecret: this.crypto.encrypt(secret) },
    });
    return { secret, otpauthUrl: buildOtpAuthUrl(secret, admin.email, TOTP_ISSUER) };
  }

  /**
   * Confirms the first TOTP code, flips MFA on, and generates 10 recovery codes.
   * The raw recovery codes are returned exactly once; only their hashes persist.
   */
  async verifyAndEnable(
    admin: AdminUser,
    code: string,
    tx?: Prisma.TransactionClient,
    afterWrite?: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<string[]> {
    if (admin.mfaEnabledAt) {
      throw new ConflictException('MFA is already enabled');
    }
    if (!admin.mfaSecret) {
      throw new BadRequestException('Start MFA setup before verifying');
    }
    const secret = this.crypto.decrypt(admin.mfaSecret);
    if (!verifyTotp(secret, code)) {
      throw new BadRequestException('Invalid verification code');
    }

    const rawCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => this.generateRecoveryCode());
    const hashes = await Promise.all(
      rawCodes.map((c) => bcrypt.hash(this.normalizeRecoveryCode(c), BCRYPT_ROUNDS)),
    );

    const client = tx ?? this.prisma;
    const operations = [
      // Replace any prior recovery codes so a re-enroll never leaves stale ones.
      client.adminMfaRecoveryCode.deleteMany({ where: { adminUserId: admin.id } }),
      client.adminMfaRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ adminUserId: admin.id, codeHash })),
      }),
      client.adminUser.update({
        where: { id: admin.id },
        data: { mfaEnabledAt: new Date() },
      }),
    ];
    if (tx) {
      await Promise.all(operations);
      if (afterWrite) await afterWrite(tx);
    } else if (afterWrite) {
      await this.prisma.$transaction(async (transaction) => {
        await Promise.all([
          transaction.adminMfaRecoveryCode.deleteMany({ where: { adminUserId: admin.id } }),
          transaction.adminMfaRecoveryCode.createMany({
            data: hashes.map((codeHash) => ({ adminUserId: admin.id, codeHash })),
          }),
          transaction.adminUser.update({
            where: { id: admin.id },
            data: { mfaEnabledAt: new Date() },
          }),
        ]);
        await afterWrite(transaction);
      });
    } else await this.prisma.$transaction(operations);

    this.logger.log(`MFA enabled for admin ${admin.id}`);
    return rawCodes;
  }

  /**
   * Verifies a login-time MFA code against an MFA-enabled admin: first as a TOTP
   * code, then (if that fails) against the admin's unused recovery codes, marking
   * a matched recovery code consumed. Returns true on success.
   */
  async verifyLoginCode(admin: AdminUser, code: string): Promise<boolean> {
    if (!admin.mfaEnabledAt || !admin.mfaSecret) {
      return false;
    }
    const secret = this.crypto.decrypt(admin.mfaSecret);
    if (verifyTotp(secret, code)) {
      return true;
    }
    return this.consumeRecoveryCode(admin.id, code);
  }

  /** Clears all MFA state for an admin (used by the admins.manage reset-mfa action). */
  async reset(adminUserId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    const operations = [
      client.adminMfaRecoveryCode.deleteMany({ where: { adminUserId } }),
      client.adminUser.update({
        where: { id: adminUserId },
        data: { mfaSecret: null, mfaEnabledAt: null },
      }),
    ];
    if (tx) {
      await Promise.all(operations);
    } else {
      await this.prisma.$transaction(operations);
    }
  }

  private async consumeRecoveryCode(adminUserId: string, code: string): Promise<boolean> {
    const normalized = this.normalizeRecoveryCode(code);
    const candidates = await this.prisma.adminMfaRecoveryCode.findMany({
      where: { adminUserId, usedAt: null },
    });
    for (const candidate of candidates) {
      if (await bcrypt.compare(normalized, candidate.codeHash)) {
        // Claim the code with a compare-and-set. Two concurrent login requests
        // may both have read the same unused row above; only one is allowed to
        // transition it from unused -> used.
        const claimed = await this.prisma.adminMfaRecoveryCode.updateMany({
          where: { id: candidate.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (claimed.count !== 1) {
          continue;
        }
        this.logger.log(`Recovery code consumed for admin ${adminUserId}`);
        return true;
      }
    }
    return false;
  }

  /** e.g. "a1b2-c3d4-e5f6" — 12 hex chars grouped for readability. */
  private generateRecoveryCode(): string {
    const hex = randomBytes(6).toString('hex');
    return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
  }

  private normalizeRecoveryCode(code: string): string {
    return code.replace(/[\s-]/g, '').toLowerCase();
  }
}
