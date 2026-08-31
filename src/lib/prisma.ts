import { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const prisma =
  global.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('✅ Conexão com o banco de dados PostgreSQL estabelecida com sucesso.');
    return true;
  } catch (error) {
    logger.error({ error }, '❌ Falha ao conectar ao banco de dados PostgreSQL. Verifique sua DATABASE_URL.');
    return false;
  }
}
