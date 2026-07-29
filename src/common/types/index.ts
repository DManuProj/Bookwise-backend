import { Organisation, User } from '../../generated/prisma/client.js';

export type AuthenticatedUser = User & {
  org: Organisation | null;
};

// A verified Clerk token whose DB user row doesn't exist yet (webhook delayed,
// lost, or never configured). Onboarding provisions the real row; OrgGuard
// still rejects these everywhere else because orgId is null.
export type BootstrapUser = {
  isBootstrapping: true;
  clerkId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  orgId: null;
  org: null;
};

// What ClerkAuthGurad attaches to request.user
export type RequestUser = AuthenticatedUser | BootstrapUser;

export const isBootstrapUser = (user: RequestUser): user is BootstrapUser =>
  (user as BootstrapUser).isBootstrapping === true;
