import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../db/client";
import { createHostService, type HostDb } from "./host-service";

export const hostService = createHostService(createPrismaHostDb(prisma));

function createPrismaHostDb(db: PrismaClient): HostDb {
  return {
    machine: {
      findFirst(args) {
        return db.machine.findFirst(args ?? undefined);
      },
      findUnique(args) {
        return db.machine.findUnique(args);
      },
      update(args) {
        const data = args.data as Prisma.MachineUpdateArgs["data"];

        return db.machine.update({
          where: args.where,
          data
        });
      }
    }
  };
}
