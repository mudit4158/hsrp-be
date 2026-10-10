import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomInt } from 'node:crypto';
import { env } from '../../platform/config/env';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { Problem } from '../../platform/http/problem';
import { NotificationService } from '../notification/notification.service';

const TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_PER_WINDOW = 5;
const WINDOW_MS = 15 * 60_000;

const hashCode = (id: string, code: string) => createHash('sha256').update(`${id}:${code}`).digest('hex');
export const maskMobile = (m: string) => (m.length > 4 ? `${'*'.repeat(m.length - 4)}${m.slice(-4)}` : m);

/**
 * One-time passwords. Codes are random and stored hashed; they are delivered through the Notification
 * utility (so they appear on the simulator's message list). With DEMO_MODE=true a fixed code is also accepted.
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationService,
  ) {}

  async request(input: { purpose: string; recipient: string; context?: Record<string, unknown>; templateCode?: string }) {
    const tenantId = requestContext.tenantId();
    const recent = await this.prisma.iamOtp.count({
      where: { tenantId, recipient: input.recipient, createdAt: { gte: new Date(Date.now() - WINDOW_MS) } },
    });
    if (recent >= MAX_PER_WINDOW) throw new Problem(429, 'Too many requests', 'Too many OTP requests. Try again in 15 minutes.', 'otp-rate-limit');

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + TTL_MS);
    const otp = await this.prisma.tx(async (tx) => {
      const row = await tx.iamOtp.create({
        data: { tenantId, purpose: input.purpose, recipient: input.recipient, codeHash: 'pending', context: (input.context ?? {}) as Prisma.InputJsonValue, expiresAt },
      });
      await tx.iamOtp.update({ where: { id: row.id }, data: { codeHash: hashCode(row.id, code) } });
      await this.notify.send(
        {
          templateCode: input.templateCode ?? 'OTP',
          channel: 'SMS',
          recipient: input.recipient,
          variables: { otp: code, minutes: String(TTL_MS / 60_000) },
          subjectType: 'otp',
          subjectId: row.id,
        },
        tx,
      );
      return row;
    });
    return { otpRef: otp.id, expiresAt, sentTo: maskMobile(input.recipient) };
  }

  /** Verifies and consumes an OTP; returns the context stored with it. */
  async verify(otpRef: string, code: string, purpose?: string): Promise<{ recipient: string; context: Record<string, unknown> }> {
    const otp = await this.prisma.iamOtp.findUnique({ where: { id: otpRef } });
    if (!otp || otp.tenantId !== requestContext.tenantId()) throw Problem.badRequest('OTP not found. Request a new one.', 'otp-invalid');
    if (purpose && otp.purpose !== purpose) throw Problem.badRequest('OTP was issued for another purpose', 'otp-invalid');
    if (otp.consumedAt) throw Problem.badRequest('OTP already used. Request a new one.', 'otp-used');
    if (otp.expiresAt < new Date()) throw Problem.badRequest('OTP expired. Request a new one.', 'otp-expired');
    if (otp.attempts >= MAX_ATTEMPTS) throw Problem.badRequest('Too many wrong attempts. Request a new one.', 'otp-locked');

    const ok = hashCode(otp.id, code) === otp.codeHash || (env.demoMode && code === env.demoFixedOtp);
    if (!ok) {
      await this.prisma.iamOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw Problem.badRequest('Wrong OTP', 'otp-wrong');
    }
    await this.prisma.iamOtp.update({ where: { id: otp.id }, data: { verifiedAt: new Date(), consumedAt: new Date() } });
    return { recipient: otp.recipient, context: (otp.context ?? {}) as Record<string, unknown> };
  }
}
