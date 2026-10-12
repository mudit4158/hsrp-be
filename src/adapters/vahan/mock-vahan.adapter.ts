import { Injectable, Logger } from '@nestjs/common';
import type { VahanMode } from '@hsrp/contracts';
import { PrismaService } from '../../platform/database/prisma.service';
import {
  RegistryUnavailableError,
  VahanFitmentRequest,
  VahanLookupReply,
  VahanLookupRequest,
  VehicleRegistry,
} from '../../core/ports/vehicle-registry.port';
import { MockStateService } from '../mock-state.service';

const EMPTY: Omit<VahanLookupReply, 'message'> = {
  fuel: '', maker: '', vchType: '', norms: '', vchCatg: '', regnDate: '', hsrpFrontLaserCode: '', hsrpRearLaserCode: '', stateCd: '', offCd: '',
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Mock VAHAN. Serves vehicles from adp_mock_vahan_vehicle. The simulator switches its mode:
 * normal, slow (4 s delay), down (connection error), not-found (every lookup misses).
 */
@Injectable()
export class MockVahanAdapter implements VehicleRegistry {
  private readonly log = new Logger('MockVAHAN');

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: MockStateService,
  ) {}

  private async gate(): Promise<VahanMode> {
    const mode = await this.state.get<VahanMode>('vahan.mode', 'normal');
    if (mode === 'down') throw new RegistryUnavailableError('VAHAN not reachable (mock is set to down)');
    if (mode === 'slow') await sleep(4000);
    return mode;
  }

  async lookup(req: VahanLookupRequest): Promise<VahanLookupReply> {
    const mode = await this.gate();
    if (mode === 'not-found') return { message: 'Vehicle details not found', ...EMPTY };
    const v = await this.prisma.mockVahanVehicle.findUnique({ where: { regnNo: req.regnNO.toUpperCase() } });
    if (!v) return { message: 'Vehicle details not found', ...EMPTY };
    if (!v.chassisNo.endsWith(req.chasisNo.toUpperCase().slice(-5)) || !v.engineNo.endsWith(req.engineNo.toUpperCase().slice(-5))) {
      return { message: 'Chassis number or engine number does not match', ...EMPTY };
    }
    return {
      message: 'Success',
      fuel: v.fuel,
      maker: v.maker,
      vchType: v.vchType,
      norms: v.norms,
      vchCatg: v.vchCatg,
      regnDate: v.regnDate,
      hsrpFrontLaserCode: v.hsrpFrontLaserCode ?? '',
      hsrpRearLaserCode: v.hsrpRearLaserCode ?? '',
      stateCd: v.stateCd,
      offCd: v.offCd,
    };
  }

  async recordFitment(req: VahanFitmentRequest): Promise<string> {
    await this.gate();
    const v = await this.prisma.mockVahanVehicle.findUnique({ where: { regnNo: req.regnNO.toUpperCase() } });
    if (!v) return `Vehicle ${req.regnNO} not found`;
    // A fixture vehicle that makes VAHAN answer with text the adapter cannot recognise.
    if (v.scenario === 'garbled-post') return 'ERR#5503 <html>Gateway Timeout</html>';
    if (!/^\d{2}-\d{2}-\d{4}$/.test(req.fixationdate)) return 'Invalid fixation date format';
    await this.prisma.mockVahanVehicle.update({
      where: { id: v.id },
      data: { hsrpFrontLaserCode: req.hsrpFrontLaserCode || v.hsrpFrontLaserCode, hsrpRearLaserCode: req.hsrpRearLaserCode || v.hsrpRearLaserCode },
    });
    this.log.log(`Fitment recorded for ${req.regnNO}`);
    return `HSRP details updated successfully for ${req.regnNO}`;
  }

  async uploadInventory(req: { stationCode: string; laserCodes: string[] }): Promise<void> {
    this.log.log(`uploadInventory stub: ${req.laserCodes.length} codes from ${req.stationCode}`);
  }
}
