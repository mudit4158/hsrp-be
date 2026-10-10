import { Injectable } from '@nestjs/common';
import { VahanFitmentRequest, VahanLookupReply, VahanLookupRequest, VehicleRegistry } from '../../core/ports/vehicle-registry.port';

/** Placeholder for the real VAHAN integration. Not built in the prototype (the contract is unconfirmed, D3). */
@Injectable()
export class RealVahanAdapter implements VehicleRegistry {
  lookup(_req: VahanLookupRequest): Promise<VahanLookupReply> {
    throw new Error('Real VAHAN adapter is not implemented. Set VAHAN_ADAPTER=mock.');
  }
  recordFitment(_req: VahanFitmentRequest): Promise<string> {
    throw new Error('Real VAHAN adapter is not implemented. Set VAHAN_ADAPTER=mock.');
  }
  uploadInventory(): Promise<void> {
    throw new Error('Real VAHAN adapter is not implemented. Set VAHAN_ADAPTER=mock.');
  }
}
