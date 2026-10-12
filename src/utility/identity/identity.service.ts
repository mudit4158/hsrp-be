import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { env } from '../../platform/config/env';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { Problem } from '../../platform/http/problem';
import { AuditService } from '../audit/audit.service';
import { DeviceService } from './device.service';
import { hashPassword, verifyPassword } from './password';

/** Organisations, users, roles and sessions. Knows nothing about what an organisation *is* in the business. */
@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly devices: DeviceService,
    private readonly audit: AuditService,
  ) {}

  async login(input: { username: string; password: string; deviceId?: string; deviceName?: string }) {
    const tenantId = requestContext.tenantId();
    const user = await this.prisma.iamUser.findUnique({ where: { tenantId_username: { tenantId, username: input.username.trim().toLowerCase() } } });
    const ok = user?.active && (await verifyPassword(input.password, user.passwordHash));
    if (!user || !ok) {
      await this.audit.record({ action: 'auth.login.failed', subjectType: 'user', subjectId: user?.id, after: { username: input.username }, actorType: 'anonymous' });
      throw Problem.unauthorized('Wrong username or password');
    }
    if (input.deviceId) await this.devices.register(tenantId, user.id, input.deviceId, input.deviceName);
    const perms = await this.permissionsFor(tenantId, user.roles);
    const token = await this.jwt.signAsync({
      sub: user.id,
      tid: tenantId,
      kind: 'user',
      name: user.displayName,
      roles: user.roles,
      perms,
      org: user.orgId,
      ...(input.deviceId ? { dev: input.deviceId } : {}),
    });
    await this.prisma.iamUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    requestContext.set({ actor: { id: user.id, type: 'user', name: user.displayName, roles: user.roles, permissions: perms, orgId: user.orgId } });
    await this.audit.record({ action: 'auth.login', subjectType: 'user', subjectId: user.id });
    return { token, expiresIn: env.jwtExpiresIn, user: this.publicUser(user, perms) };
  }

  /** Short-lived token for a customer who proved a mobile number (and optionally a vehicle) by OTP. */
  async issueCustomerToken(input: { mobile: string; claims: Record<string, unknown> }) {
    const tenantId = requestContext.tenantId();
    const perms = await this.permissionsFor(tenantId, ['CUSTOMER']);
    const token = await this.jwt.signAsync(
      { sub: `customer:${input.mobile}`, tid: tenantId, kind: 'customer', name: 'Customer', roles: ['CUSTOMER'], perms, claims: input.claims },
      { expiresIn: '30m' },
    );
    return { token, expiresIn: '30m' };
  }

  async me() {
    const actor = requestContext.actor();
    if (!actor) throw Problem.unauthorized();
    if (actor.type !== 'user') return { id: actor.id, displayName: actor.name, roles: actor.roles, permissions: actor.permissions, claims: actor.claims };
    const user = await this.prisma.iamUser.findUniqueOrThrow({ where: { id: actor.id } });
    const org = user.orgId ? await this.prisma.iamOrg.findUnique({ where: { id: user.orgId } }) : null;
    return { ...this.publicUser(user, actor.permissions), org };
  }

  async permissionsFor(tenantId: string, roles: string[]) {
    const rows = await this.prisma.iamRole.findMany({ where: { tenantId, code: { in: roles } } });
    return [...new Set(rows.flatMap((r) => r.permissions))];
  }

  async createUser(input: { username: string; displayName: string; password: string; roles: string[]; orgId?: string | null; mobile?: string; email?: string }) {
    const tenantId = requestContext.tenantId();
    const user = await this.prisma.iamUser.create({
      data: {
        tenantId,
        username: input.username.trim().toLowerCase(),
        displayName: input.displayName,
        passwordHash: await hashPassword(input.password),
        roles: input.roles,
        orgId: input.orgId ?? null,
        mobile: input.mobile,
        email: input.email,
      },
    });
    await this.audit.record({ action: 'user.create', subjectType: 'user', subjectId: user.id, after: { username: user.username, roles: user.roles } });
    return this.publicUser(user, []);
  }

  async updateUser(id: string, patch: { displayName?: string; roles?: string[]; active?: boolean; password?: string; orgId?: string | null }) {
    const tenantId = requestContext.tenantId();
    const before = await this.prisma.iamUser.findFirst({ where: { id, tenantId } });
    if (!before) throw Problem.notFound('User');
    const user = await this.prisma.iamUser.update({
      where: { id },
      data: {
        displayName: patch.displayName,
        roles: patch.roles,
        active: patch.active,
        orgId: patch.orgId,
        ...(patch.password ? { passwordHash: await hashPassword(patch.password) } : {}),
      },
    });
    await this.audit.record({
      action: 'user.update',
      subjectType: 'user',
      subjectId: id,
      before: { roles: before.roles, active: before.active, displayName: before.displayName },
      after: { roles: user.roles, active: user.active, displayName: user.displayName, passwordChanged: Boolean(patch.password) },
    });
    return this.publicUser(user, []);
  }

  listUsers() {
    return this.prisma.iamUser.findMany({
      where: { tenantId: requestContext.tenantId() },
      orderBy: { username: 'asc' },
      select: { id: true, username: true, displayName: true, roles: true, orgId: true, active: true, mobile: true, email: true, lastLoginAt: true },
    });
  }

  listRoles() {
    return this.prisma.iamRole.findMany({ where: { tenantId: requestContext.tenantId() }, orderBy: { code: 'asc' } });
  }

  async updateRole(code: string, permissions: string[]) {
    const tenantId = requestContext.tenantId();
    const before = await this.prisma.iamRole.findUnique({ where: { tenantId_code: { tenantId, code } } });
    if (!before) throw Problem.notFound('Role');
    const role = await this.prisma.iamRole.update({ where: { id: before.id }, data: { permissions } });
    await this.audit.record({ action: 'role.update', subjectType: 'role', subjectId: code, before: before.permissions, after: permissions });
    return role;
  }

  listOrgs(orgType?: string) {
    return this.prisma.iamOrg.findMany({ where: { tenantId: requestContext.tenantId(), ...(orgType ? { orgType } : {}) }, orderBy: { code: 'asc' } });
  }

  /** Creates or updates an organisation node in the hierarchy. */
  async upsertOrg(input: { code: string; name: string; orgType: string; parentId?: string | null; externalRef?: string }) {
    const tenantId = requestContext.tenantId();
    return this.prisma.iamOrg.upsert({
      where: { tenantId_code: { tenantId, code: input.code } },
      create: { tenantId, ...input },
      update: { name: input.name, orgType: input.orgType, parentId: input.parentId, externalRef: input.externalRef },
    });
  }

  private publicUser(u: { id: string; username: string; displayName: string; roles: string[]; orgId: string | null; mobile?: string | null; email?: string | null }, perms: string[]) {
    return { id: u.id, username: u.username, displayName: u.displayName, roles: u.roles, orgId: u.orgId, mobile: u.mobile, email: u.email, permissions: perms };
  }
}
