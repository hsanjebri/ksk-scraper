import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'auth:isPublic';

/**
 * Opts a route out of the dashboard session check. Every route is protected
 * unless it says otherwise — a forgotten decorator fails closed, not open.
 * Use sparingly, and say in a comment what protects the route instead.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
