import { Injectable } from '@nestjs/common';
import { Actor, requestContext } from '../../platform/context/request-context';
import { Problem } from '../../platform/http/problem';
import { MastersService } from './masters.service';

export interface ActorScope {
  /** Staff (admin, operations) see everything. */
  all: boolean;
  dealerId?: string;
  stationId?: string;
  oemId?: string;
  customerRegnNo?: string;
  customerMobile?: string;
}

/** Translates the signed-in actor's organisation into the HSRP records it may see. */
@Injectable()
export class ScopeService {
  constructor(private readonly masters: MastersService) {}

  async current(actor: Actor | undefined = requestContext.actor()): Promise<ActorScope> {
    if (!actor) throw Problem.unauthorized();
    if (actor.permissions.includes('*') || actor.roles.includes('ADMIN') || actor.roles.includes('OPERATIONS')) return { all: true };
    if (actor.roles.includes('DEALER')) {
      const d = await this.masters.dealerForOrg(actor.orgId);
      if (!d) throw Problem.forbidden('Your user is not linked to a dealer');
      return { all: false, dealerId: d.id };
    }
    if (actor.roles.includes('STATION_USER')) {
      const s = await this.masters.stationForOrg(actor.orgId);
      if (!s) throw Problem.forbidden('Your user is not linked to an embossing station');
      return { all: false, stationId: s.id };
    }
    if (actor.roles.includes('OEM_CLIENT')) {
      const o = await this.masters.oemForOrg(actor.orgId);
      if (!o) throw Problem.forbidden('This client is not linked to an OEM');
      return { all: false, oemId: o.id };
    }
    if (actor.roles.includes('CUSTOMER')) {
      return { all: false, customerRegnNo: actor.claims?.regnNo as string | undefined, customerMobile: actor.claims?.mobile as string | undefined };
    }
    throw Problem.forbidden();
  }

  async dealerId(): Promise<string> {
    const s = await this.current();
    if (!s.dealerId) throw Problem.forbidden('Only dealers can do this');
    return s.dealerId;
  }

  /** Filter for queries on records that carry dealerId / stationId / oemId. */
  async where(): Promise<Record<string, string>> {
    const s = await this.current();
    if (s.all) return {};
    if (s.dealerId) return { dealerId: s.dealerId };
    if (s.stationId) return { stationId: s.stationId };
    if (s.oemId) return { oemId: s.oemId };
    if (s.customerRegnNo) return { regnNo: s.customerRegnNo };
    return { id: '__none__' };
  }
}
