import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { LoginRequest } from '@hsrp/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { requestContext } from '../../platform/context/request-context';
import { Public, RequirePermission } from '../../platform/http/decorators';
import { ApiClientService } from './api-client.service';
import { DeviceService } from './device.service';
import { IdentityService } from './identity.service';

class LoginDto extends createZodDto(LoginRequest) {}
class CreateUserDto extends createZodDto(
  z.object({
    username: z.string().min(3).max(60),
    displayName: z.string().min(2).max(100),
    password: z.string().min(8).max(100),
    roles: z.array(z.string()).min(1),
    orgId: z.string().nullable().optional(),
    mobile: z.string().optional(),
    email: z.string().email().optional(),
  }),
) {}
class UpdateUserDto extends createZodDto(
  z.object({
    displayName: z.string().min(2).max(100).optional(),
    roles: z.array(z.string()).min(1).optional(),
    active: z.boolean().optional(),
    password: z.string().min(8).max(100).optional(),
    orgId: z.string().nullable().optional(),
  }),
) {}
class RolePermsDto extends createZodDto(z.object({ permissions: z.array(z.string()) })) {}
class DeviceActiveDto extends createZodDto(z.object({ active: z.boolean() })) {}
class ApiClientDto extends createZodDto(z.object({ orgId: z.string(), name: z.string().min(2), roles: z.array(z.string()).min(1) })) {}

@ApiTags('identity')
@ApiBearerAuth()
@Controller()
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly devices: DeviceService,
    private readonly apiClients: ApiClientService,
  ) {}

  @Post('auth/login')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  login(@Body() body: LoginDto) {
    return this.identity.login(body);
  }

  @Get('auth/me')
  me() {
    return this.identity.me();
  }

  @Get('iam/users')
  @RequirePermission('iam.manage')
  users() {
    return this.identity.listUsers();
  }

  @Post('iam/users')
  @RequirePermission('iam.manage')
  createUser(@Body() body: CreateUserDto) {
    return this.identity.createUser(body);
  }

  @Patch('iam/users/:id')
  @RequirePermission('iam.manage')
  updateUser(@Param('id') id: string, @Body() body: UpdateUserDto) {
    return this.identity.updateUser(id, body);
  }

  @Get('iam/roles')
  @RequirePermission('iam.manage')
  roles() {
    return this.identity.listRoles();
  }

  @Patch('iam/roles/:code')
  @RequirePermission('iam.manage')
  updateRole(@Param('code') code: string, @Body() body: RolePermsDto) {
    return this.identity.updateRole(code, body.permissions);
  }

  @Get('iam/orgs')
  @RequirePermission('iam.manage', 'masters.read')
  orgs(@Query('orgType') orgType?: string) {
    return this.identity.listOrgs(orgType);
  }

  @Get('iam/devices')
  @RequirePermission('iam.manage')
  devicesList(@Query('userId') userId?: string) {
    return this.devices.list(requestContext.tenantId(), userId);
  }

  @Patch('iam/devices/:id')
  @RequirePermission('iam.manage')
  setDevice(@Param('id') id: string, @Body() body: DeviceActiveDto) {
    return this.devices.setActive(requestContext.tenantId(), id, body.active);
  }

  @Get('iam/api-clients')
  @RequirePermission('iam.manage')
  clients() {
    return this.apiClients.list(requestContext.tenantId());
  }

  @Post('iam/api-clients')
  @RequirePermission('iam.manage')
  createClient(@Body() body: ApiClientDto) {
    return this.apiClients.create(requestContext.tenantId(), body);
  }
}
