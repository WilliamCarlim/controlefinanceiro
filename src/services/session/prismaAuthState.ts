import {
  AuthenticationCreds,
  AuthenticationState,
  BufferJSON,
  initAuthCreds,
  SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

/**
 * Custom Prisma Auth State for Baileys
 * Persiste credenciais e chaves criptográficas diretamente no PostgreSQL.
 * Garante que restarts no Render não percam a sessão.
 */
export async function usePrismaAuthState(
  sessionId = 'session_main'
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void>; clearSession: () => Promise<void> }> {
  const credsKey = `${sessionId}:creds`;

  // Carrega as credenciais existentes do banco ou inicializa novas
  let creds: AuthenticationCreds;

  try {
    const credsRecord = await prisma.whatsAppSession.findUnique({
      where: { id: credsKey },
    });

    if (credsRecord && credsRecord.data) {
      const parsed = JSON.parse(
        JSON.stringify(credsRecord.data),
        BufferJSON.reviver
      );
      creds = parsed as AuthenticationCreds;
      logger.info({ sessionId }, '🔑 Credenciais do WhatsApp carregadas do PostgreSQL.');
    } else {
      creds = initAuthCreds();
      logger.info({ sessionId }, '🆕 Novas credenciais do WhatsApp inicializadas.');
    }
  } catch (error) {
    logger.error({ error, sessionId }, 'Erro ao carregar credenciais do PostgreSQL. Criando novas.');
    creds = initAuthCreds();
  }

  // Função para salvar as credenciais principais
  const saveCreds = async (): Promise<void> => {
    try {
      const serialized = JSON.parse(
        JSON.stringify(creds, BufferJSON.replacer)
      );

      await prisma.whatsAppSession.upsert({
        where: { id: credsKey },
        update: {
          data: serialized,
        },
        create: {
          id: credsKey,
          data: serialized,
        },
      });
    } catch (error) {
      logger.error({ error, credsKey }, 'Erro ao salvar credenciais do WhatsApp no PostgreSQL.');
    }
  };

  // Função para limpar a sessão em caso de logout ou reset
  const clearSession = async (): Promise<void> => {
    try {
      await prisma.whatsAppSession.deleteMany({
        where: {
          id: {
            startsWith: `${sessionId}:`,
          },
        },
      });
      logger.info({ sessionId }, '🧹 Sessão do WhatsApp removida do banco de dados.');
    } catch (error) {
      logger.error({ error, sessionId }, 'Erro ao limpar sessão do WhatsApp no PostgreSQL.');
    }
  };

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[]
        ): Promise<{ [key: string]: SignalDataTypeMap[T] }> => {
          const result: { [key: string]: SignalDataTypeMap[T] } = {};

          if (!ids.length) return result;

          const dbKeys = ids.map((id) => `${sessionId}:${type}:${id}`);

          try {
            const records = await prisma.whatsAppSession.findMany({
              where: {
                id: { in: dbKeys },
              },
            });

            for (const record of records) {
              const prefix = `${sessionId}:${type}:`;
              const originalId = record.id.startsWith(prefix)
                ? record.id.substring(prefix.length)
                : record.id;

              if (record.data) {
                const parsed = JSON.parse(
                  JSON.stringify(record.data),
                  BufferJSON.reviver
                );
                result[originalId] = parsed;
              }
            }
          } catch (error) {
            logger.error({ error, type, idsCount: ids.length }, 'Erro ao buscar chaves de sessão no PostgreSQL.');
          }

          return result;
        },

        set: async (data: any): Promise<void> => {
          const upsertOps: { id: string; data: any }[] = [];
          const deleteKeys: string[] = [];

          for (const type in data) {
            const categoryData = data[type];
            for (const id in categoryData) {
              const value = categoryData[id];
              const key = `${sessionId}:${type}:${id}`;

              if (value) {
                const serialized = JSON.parse(
                  JSON.stringify(value, BufferJSON.replacer)
                );
                upsertOps.push({ id: key, data: serialized });
              } else {
                deleteKeys.push(key);
              }
            }
          }

          try {
            if (deleteKeys.length > 0) {
              await prisma.whatsAppSession.deleteMany({
                where: { id: { in: deleteKeys } },
              });
            }

            // Executa upserts sequencialmente em pequenos batches para não sobrecarregar o pool
            for (const item of upsertOps) {
              await prisma.whatsAppSession.upsert({
                where: { id: item.id },
                update: { data: item.data },
                create: { id: item.id, data: item.data },
              });
            }
          } catch (error) {
            logger.error({ error }, 'Erro ao salvar chaves criptográficas no PostgreSQL.');
          }
        },
      },
    },
    saveCreds,
    clearSession,
  };
}
