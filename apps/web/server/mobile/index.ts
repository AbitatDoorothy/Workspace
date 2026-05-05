import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../db/client";
import { createMobileService, type MobileDb } from "./mobile-service";

export const mobileService = createMobileService(createPrismaMobileDb(prisma));

function createPrismaMobileDb(db: PrismaClient): MobileDb {
  return {
    machine: {
      create(args) {
        return db.machine.create({
          data: args.data as Prisma.MachineUncheckedCreateInput
        });
      },
      findFirst(args) {
        return db.machine.findFirst({
          where: args.where as Prisma.MachineWhereInput
        });
      },
      findMany(args) {
        return db.machine.findMany({
          where: args.where as Prisma.MachineWhereInput
        });
      },
      findUnique(args) {
        return db.machine.findUnique(args);
      },
      update(args) {
        return db.machine.update({
          where: args.where,
          data: args.data as Prisma.MachineUncheckedUpdateInput
        });
      }
    },
    devicePairing: {
      create(args) {
        return db.devicePairing.create({
          data: args.data as Prisma.DevicePairingUncheckedCreateInput
        });
      },
      findFirst(args) {
        return db.devicePairing.findFirst({
          where: args.where as Prisma.DevicePairingWhereInput
        });
      },
      update(args) {
        return db.devicePairing.update({
          where: args.where,
          data: args.data as Prisma.DevicePairingUncheckedUpdateInput
        });
      }
    },
    project: {
      findMany(args) {
        return db.project.findMany({
          where: args.where,
          orderBy: { updatedAt: "desc" }
        });
      }
    },
    workspace: {
      findUnique(args) {
        return db.workspace.findUnique(args);
      }
    }
  };
}
