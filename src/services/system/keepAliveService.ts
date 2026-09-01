import http from 'http';
import https from 'https';
import { config } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { whatsAppService } from '../whatsapp/baileysClient.js';

class KeepAliveService {
  private httpPingTimer: NodeJS.Timeout | null = null;
  private dbPingTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;

  public start(): void {
    logger.info('🛡️ Inicializando serviço Keep-Alive e Watchdog do Sistema...');

    this.startHttpSelfPing();
    this.startDatabaseKeepAlive();
    this.startWhatsAppWatchdog();
  }

  /**
   * Auto-Ping HTTP periódico na URL pública externa para evitar hibernação no Render (Free Tier)
   */
  private startHttpSelfPing(): void {
    const targetUrl = config.appUrl || 'https://controlefinanceiro-wvq0.onrender.com';
    const intervalMs = config.keepAliveIntervalMinutes * 60 * 1000; // Padrão: 5 minutos

    logger.info(
      { targetUrl, intervalMinutes: config.keepAliveIntervalMinutes },
      '⏰ Auto-Ping HTTP Keep-Alive configurado na URL pública.'
    );

    // Executa primeiro ping após 15 segundos
    setTimeout(() => this.pingUrl(targetUrl), 15 * 1000);

    // Agenda execuções periódicas
    this.httpPingTimer = setInterval(() => {
      this.pingUrl(targetUrl);
    }, intervalMs);
  }

  private pingUrl(baseUrl: string): void {
    try {
      const cleanUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      const fullUrl = `${cleanUrl}/health`;

      const client = fullUrl.startsWith('https') ? https : http;

      const req = client.get(fullUrl, { timeout: 20000 }, (res) => {
        logger.info(
          { url: fullUrl, statusCode: res.statusCode },
          '💓 [Keep-Alive] Ping HTTP público executado com sucesso (serviço ativo).'
        );
      });

      req.on('error', (err) => {
        logger.warn({ error: err.message, url: fullUrl }, '⚠️ [Keep-Alive] Falha no ping HTTP.');
      });

      req.on('timeout', () => {
        req.destroy();
        logger.warn({ url: fullUrl }, '⚠️ [Keep-Alive] Timeout no ping HTTP.');
      });
    } catch (err: any) {
      logger.warn({ error: err?.message }, '⚠️ [Keep-Alive] Erro ao disparar ping HTTP.');
    }
  }

  /**
   * Ping no Banco de Dados PostgreSQL a cada 3 minutos
   */
  private startDatabaseKeepAlive(): void {
    const intervalMs = config.dbKeepAliveIntervalMinutes * 60 * 1000; // Padrão: 3 minutos

    this.dbPingTimer = setInterval(async () => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        logger.info('🗄️ [Keep-Alive] Ping no PostgreSQL executado com sucesso (banco ativo).');
      } catch (err: any) {
        logger.error({ error: err?.message }, '❌ [Keep-Alive] Erro no ping do banco de dados.');
      }
    }, intervalMs);
  }

  /**
   * Watchdog do WhatsApp
   * Verifica a cada 1 minuto se o WhatsApp está desconectado e força reconexão
   */
  private startWhatsAppWatchdog(): void {
    this.watchdogTimer = setInterval(async () => {
      try {
        const state = whatsAppService.getState();
        if (state.status === 'DISCONNECTED') {
          logger.warn('🔍 [Watchdog] WhatsApp detectado como DISCONNECTED. Tentando reconectar...');
          await whatsAppService.start();
        }
      } catch (err: any) {
        logger.error({ error: err?.message }, '❌ [Watchdog] Erro ao verificar status do WhatsApp.');
      }
    }, 60 * 1000);
  }

  public stop(): void {
    if (this.httpPingTimer) clearInterval(this.httpPingTimer);
    if (this.dbPingTimer) clearInterval(this.dbPingTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
  }
}

export const keepAliveService = new KeepAliveService();
