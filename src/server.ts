import express from 'express';
import cors from 'cors';
import { config, validateConfig } from './config/env.js';
import { logger } from './lib/logger.js';
import { checkDatabaseConnection, prisma } from './lib/prisma.js';
import { whatsAppService } from './services/whatsapp/baileysClient.js';
import { router as webRouter } from './web/routes.js';
import { keepAliveService } from './services/system/keepAliveService.js';

async function bootstrap() {
  logger.info('🚀 Inicializando Bot de Controle Financeiro...');

  // Validação de configurações
  validateConfig();

  // Teste de conexão com o banco de dados
  await checkDatabaseConnection();

  // Inicialização do servidor HTTP Express
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Rotas da Web e API
  app.use('/', webRouter);

  const server = app.listen(config.port, () => {
    logger.info(`🌐 Servidor HTTP rodando na porta ${config.port}`);
    logger.info(`📱 Acesse o painel do QR Code em: http://localhost:${config.port}/?token=${config.adminWebToken}`);
  });

  // Inicializa o cliente do WhatsApp Baileys embutido
  await whatsAppService.start();

  // Inicializa o serviço Keep-Alive (Auto-Ping Render, Ping PostgreSQL e Watchdog)
  keepAliveService.start();

  // Tratamento de encerramento seguro (Graceful Shutdown)
  const shutdown = async (signal: string) => {
    logger.info(`Recebido sinal ${signal}. Encerrando aplicação graciosamente...`);
    keepAliveService.stop();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((error) => {
  logger.error({ error }, '❌ Falha fatal ao inicializar a aplicação.');
  process.exit(1);
});
