import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'hsrp:isPublic';
export const PERMISSIONS = 'hsrp:permissions';
export const IDEMPOTENT = 'hsrp:idempotent';
export const API_CLIENT = 'hsrp:apiClient';

/** No sign-in needed. A bearer token, if sent, is still read. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Caller needs at least one of these permission strings. */
export const RequirePermission = (...perms: string[]) => SetMetadata(PERMISSIONS, perms);

/** Requires an `Idempotency-Key` header; a repeated key returns the first response instead of acting again. */
export const Idempotent = () => SetMetadata(IDEMPOTENT, true);

/** Authenticated by API key plus HMAC request signature (OEM systems). */
export const ApiClientAuth = () => SetMetadata(API_CLIENT, true);
