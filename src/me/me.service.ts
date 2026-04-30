import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../common/types/index.js';
import { UpdateMeDto } from './me.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(private readonly prisma: PrismaService) {}

  //GET - fetch me details

  // GET — return current user profile
  async getMe(user: AuthenticatedUser) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      photoUrl: user.photoUrl,
      role: user.role,
      status: user.status,
      profileComplete: user.profileComplete,
      onboardingComplete: user.onboardingComplete,
      orgId: user.orgId,
      org: user.org,
    };
  }

  //PUT upadte me info
  async updateMe(user: AuthenticatedUser, data: UpdateMeDto) {
    const updated = await this.prisma.db.user.update({
      where: { id: user.id },
      data: {
        ...data,
        profileComplete: true,
      },
    });

    this.logger.log(`Profile updated: ${updated.email}`);

    return updated;
  }
}
