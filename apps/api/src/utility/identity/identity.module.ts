import { Global, Module } from '@nestjs/common';
import { ApiClientService } from './api-client.service';
import { DeviceService } from './device.service';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { OtpService } from './otp.service';

@Global()
@Module({
  controllers: [IdentityController],
  providers: [IdentityService, OtpService, ApiClientService, DeviceService],
  exports: [IdentityService, OtpService, ApiClientService, DeviceService],
})
export class IdentityModule {}
