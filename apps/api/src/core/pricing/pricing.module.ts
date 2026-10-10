import { Body, Controller, Get, Injectable, Module, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { ORDER_TYPES, PLATE_SETS, VEHICLE_CLASSES, VEHICLE_TYPES } from '@hsrp/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { requestContext } from '../../platform/context/request-context';
import { Db, PrismaService } from '../../platform/database/prisma.service';
import { Public, RequirePermission } from '../../platform/http/decorators';
import { Problem } from '../../platform/http/problem';
import { AuditService } from '../../utility/audit/audit.service';
import { bestRule, chargeApplies, PriceQuery } from './price-match';

export interface Quote {
  ruleId: string;
  basePaise: number;
  extras: Array<{ code: string; name: string; amountPaise: number }>;
  totalPaise: number;
  query: PriceQuery;
}

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async quote(q: PriceQuery, facts: Record<string, unknown> = {}, db: Db = this.prisma): Promise<Quote> {
    const tenantId = requestContext.tenantId();
    const rules = await db.priceRule.findMany({ where: { tenantId, stateCode: q.stateCode, vehicleClass: q.vehicleClass, orderType: q.orderType, plateSet: q.plateSet } });
    const rule = bestRule(rules, q);
    if (!rule) throw Problem.unprocessable(`No price for ${q.vehicleClass} ${q.orderType} ${q.plateSet} in ${q.stateCode}`, 'price-missing');
    const charges = await db.extraCharge.findMany({ where: { tenantId, effectiveFrom: { lte: q.at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: q.at } }] } });
    const allFacts = { ...facts, stateCode: q.stateCode, vehicleClass: q.vehicleClass, orderType: q.orderType, plateSet: q.plateSet };
    const extras = charges
      .filter((c) => chargeApplies(c.conditions as Record<string, unknown>, allFacts))
      .map((c) => ({ code: c.code, name: c.name, amountPaise: c.amountPaise }));
    return { ruleId: rule.id, basePaise: rule.amountPaise, extras, totalPaise: rule.amountPaise + extras.reduce((s, e) => s + e.amountPaise, 0), query: q };
  }

  rules(filter: { stateCode?: string; current?: boolean }) {
    const now = new Date();
    return this.prisma.priceRule.findMany({
      where: {
        tenantId: requestContext.tenantId(),
        ...(filter.stateCode ? { stateCode: filter.stateCode } : {}),
        ...(filter.current ? { effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] } : {}),
      },
      orderBy: [{ stateCode: 'asc' }, { vehicleClass: 'asc' }, { orderType: 'asc' }, { plateSet: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  /** Adds a price from `effectiveFrom`, closing the previous rule with the same key. Old prices stay for history. */
  async setPrice(input: z.infer<typeof PriceRuleInput>) {
    return this.prisma.tx(async (tx) => {
      const tenantId = requestContext.tenantId();
      const from = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
      const key = { tenantId, stateCode: input.stateCode, vehicleClass: input.vehicleClass, vehicleType: input.vehicleType ?? null, oemCode: input.oemCode ?? null, orderType: input.orderType, plateSet: input.plateSet };
      const open = await tx.priceRule.findMany({ where: { ...key, effectiveTo: null, effectiveFrom: { lte: from } } });
      for (const o of open) await tx.priceRule.update({ where: { id: o.id }, data: { effectiveTo: from } });
      const rule = await tx.priceRule.create({ data: { ...key, amountPaise: Math.round(input.amountRupees * 100), published: input.published, effectiveFrom: from } });
      await this.audit.record({ action: 'price.set', subjectType: 'hsrp.price', subjectId: rule.id, before: open.map((o) => ({ id: o.id, amountPaise: o.amountPaise })), after: rule }, tx);
      return rule;
    });
  }

  extraCharges() {
    return this.prisma.extraCharge.findMany({ where: { tenantId: requestContext.tenantId() }, orderBy: { code: 'asc' } });
  }

  async addExtraCharge(input: { code: string; name: string; amountRupees: number; conditions: Record<string, unknown> }) {
    const c = await this.prisma.extraCharge.create({
      data: { tenantId: requestContext.tenantId(), code: input.code, name: input.name, amountPaise: Math.round(input.amountRupees * 100), conditions: input.conditions as Prisma.InputJsonValue, effectiveFrom: new Date() },
    });
    await this.audit.record({ action: 'price.extra-charge.create', subjectType: 'hsrp.extra-charge', subjectId: c.id, after: c });
    return c;
  }

  /** Published prices for the public portal (states whose rule pack publishes prices). */
  published(stateCode: string) {
    const now = new Date();
    return this.prisma.priceRule.findMany({
      where: { tenantId: requestContext.tenantId(), stateCode, published: true, oemCode: null, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
      orderBy: [{ vehicleClass: 'asc' }, { orderType: 'asc' }, { plateSet: 'asc' }],
      select: { vehicleClass: true, vehicleType: true, orderType: true, plateSet: true, amountPaise: true, effectiveFrom: true },
    });
  }
}

export const PriceRuleInput = z.object({
  stateCode: z.string().length(2),
  vehicleClass: z.enum(VEHICLE_CLASSES),
  vehicleType: z.enum(VEHICLE_TYPES).nullable().optional(),
  oemCode: z.string().nullable().optional(),
  orderType: z.enum(ORDER_TYPES),
  plateSet: z.enum(PLATE_SETS).default('BOTH'),
  amountRupees: z.coerce.number().positive().max(100_000),
  published: z.boolean().default(false),
  effectiveFrom: z.string().datetime().optional(),
});
class PriceRuleDto extends createZodDto(PriceRuleInput) {}
class ExtraChargeDto extends createZodDto(z.object({ code: z.string().min(2), name: z.string().min(2), amountRupees: z.coerce.number().positive(), conditions: z.record(z.unknown()) })) {}
class QuoteDto extends createZodDto(
  z.object({
    stateCode: z.string().length(2),
    vehicleClass: z.enum(VEHICLE_CLASSES),
    vehicleType: z.enum(VEHICLE_TYPES).optional(),
    oemCode: z.string().optional(),
    orderType: z.enum(ORDER_TYPES).default('NEW'),
    plateSet: z.enum(PLATE_SETS).default('BOTH'),
    greenStrip: z.enum(['true', 'false']).optional(),
  }),
) {}

@ApiTags('pricing')
@Controller()
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get('pricing/rules')
  @RequirePermission('masters.read', 'pricing.manage')
  rules(@Query('stateCode') stateCode?: string, @Query('current') current?: string) {
    return this.pricing.rules({ stateCode, current: current === 'true' });
  }

  @Post('pricing/rules')
  @RequirePermission('pricing.manage')
  setPrice(@Body() body: PriceRuleDto) {
    return this.pricing.setPrice(body);
  }

  @Get('pricing/extra-charges')
  @RequirePermission('masters.read', 'pricing.manage')
  extras() {
    return this.pricing.extraCharges();
  }

  @Post('pricing/extra-charges')
  @RequirePermission('pricing.manage')
  addExtra(@Body() body: ExtraChargeDto) {
    return this.pricing.addExtraCharge(body);
  }

  @Get('pricing/quote')
  @RequirePermission('orders.read', 'masters.read')
  quote(@Query() q: QuoteDto) {
    return this.pricing.quote({ ...q, at: new Date() }, { greenStrip: q.greenStrip === 'true' });
  }

  @Get('public/prices')
  @Public()
  published(@Query('stateCode') stateCode: string) {
    return this.pricing.published(stateCode);
  }
}

@Module({ controllers: [PricingController], providers: [PricingService], exports: [PricingService] })
export class PricingModule {}
