import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const shops = await db.shop.findMany({ select: { id: true, domain: true, name: true } });
console.log(JSON.stringify(shops, null, 2));
await db.$disconnect();
