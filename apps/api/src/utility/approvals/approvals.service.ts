import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requestContext } from '../../platform/context/request-context';
import { Db, PrismaService } from '../../platform/database/prisma.service';
import { Problem } from '../../platform/http/problem';
import { AuditService } from '../audit/audit.service';
import { EventBus } from '../integration-hub/event-bus.service';

/** Roles that may decide any approval regardless of the required role or organisation scope. */
const OVERRIDE_ROLES = ['ADMIN'];

/**
 * Request → approve or reject with mandatory remarks, by role (and optionally by organisation).
 * The decision is announced as ApprovalDecided { subjectType, subjectId, approvalType, decision }.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
    private readonly audit: AuditService,
  ) {}

  async request(
    input: { type: string; subjectType: string; subjectId: string; requiredRole: string; title: string; details?: Record<string, unknown>; scopeOrgId?: string | null },
    db: Db,
  ) {
    const open = await db.approvalRequest.findFirst({ where: { tenantId: requestContext.tenantId(), type: input.type, subjectType: input.subjectType, subjectId: input.subjectId, status: 'PENDING' } });
    if (open) return open;
    const req = await db.approvalRequest.create({
      data: {
        tenantId: requestContext.tenantId(),
        type: input.type,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        requiredRole: input.requiredRole,
        scopeOrgId: input.scopeOrgId ?? null,
        title: input.title,
        details: (input.details ?? {}) as Prisma.InputJsonValue,
        requestedBy: requestContext.actorId(),
      },
    });
    await this.bus.publish(db, { type: 'ApprovalRequested', subjectType: input.subjectType, subjectId: input.subjectId, payload: { approvalId: req.id, approvalType: input.type } });
    return req;
  }

  async decide(id: string, decision: 'APPROVE' | 'REJECT', remarks: string) {
    if (!remarks || remarks.trim().length < 3) throw Problem.badRequest('Remarks are mandatory', 'remarks-required');
    const actor = requestContext.actor();
    if (!actor) throw Problem.unauthorized();
    return this.prisma.tx(async (tx) => {
      const [locked] = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM util_approval_request WHERE id = ${id} FOR UPDATE`;
      const req = await tx.approvalRequest.findFirst({ where: { id, tenantId: requestContext.tenantId() } });
      if (!req || !locked) throw Problem.notFound('Approval request');
      if (locked.status !== 'PENDING') throw Problem.conflict(`Already ${locked.status.toLowerCase()}`, 'already-decided');
      const override = actor.roles.some((r) => OVERRIDE_ROLES.includes(r));
      if (!override && !actor.roles.includes(req.requiredRole)) throw Problem.forbidden(`Only ${req.requiredRole} can decide this`);
      if (!override && req.scopeOrgId && actor.orgId !== req.scopeOrgId) throw Problem.forbidden('This request belongs to another organisation');
      const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const updated = await tx.approvalRequest.update({ where: { id }, data: { status, remarks: remarks.trim(), decidedBy: actor.id, decidedAt: new Date() } });
      await this.bus.publish(tx, {
        type: 'ApprovalDecided',
        subjectType: req.subjectType,
        subjectId: req.subjectId,
        payload: { approvalId: id, approvalType: req.type, decision: status, remarks: remarks.trim(), decidedBy: actor.id, subjectType: req.subjectType, subjectId: req.subjectId },
      });
      await this.audit.record({ action: `approval.${status.toLowerCase()}`, subjectType: req.subjectType, subjectId: req.subjectId, before: { status: 'PENDING' }, after: { status, remarks, approvalId: id, type: req.type } }, tx);
      return updated;
    });
  }

  list(filter: { type?: string; status?: string; subjectId?: string; page?: number; pageSize?: number }) {
    const actor = requestContext.actor();
    const override = actor?.roles.some((r) => OVERRIDE_ROLES.includes(r) || r === 'OPERATIONS');
    const where: Prisma.ApprovalRequestWhereInput = {
      tenantId: requestContext.tenantId(),
      ...(filter.type ? { type: { in: filter.type.split(',') } } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.subjectId ? { subjectId: filter.subjectId } : {}),
      ...(override ? {} : { requiredRole: { in: actor?.roles ?? [] }, OR: [{ scopeOrgId: null }, { scopeOrgId: actor?.orgId ?? '__none__' }] }),
    };
    return this.prisma.approvalRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: filter.pageSize ?? 100, skip: ((filter.page ?? 1) - 1) * (filter.pageSize ?? 100) });
  }

  forSubject(subjectType: string, subjectId: string) {
    return this.prisma.approvalRequest.findMany({ where: { tenantId: requestContext.tenantId(), subjectType, subjectId }, orderBy: { createdAt: 'asc' } });
  }
}
