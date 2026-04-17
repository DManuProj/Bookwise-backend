import { Organisation, User } from '../../generated/prisma/client.js';

export type AuthenticatedUser = User & {
  org: Organisation | null;
};
