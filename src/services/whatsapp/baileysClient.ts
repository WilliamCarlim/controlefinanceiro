import makeWASocket, {
  ConnectionState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  proto,
  WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import { EventEmitter } from 'events';
import { logger } from '../../lib/logger.js';
import { usePrismaAuthState } from '../session/prismaAuthState.js';
import { handleIncomingMessage } from './messageHandler.js';
import { config } from '../../config/env.js';

export type WhatsAppConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED';

export interface WhatsAppState {
  status: WhatsAppConnectionStatus;
  qrCodeDataUrl: string | null;
  qrCodeRaw: string | null;
  botJid: string | null;
  lastConnectedAt: Date | null;
  targetGroupJid: string;
}

class WhatsAppService extends EventEmitter {
  private sock: WASocket | null = null;
  private status: WhatsAppConnectionStatus = 'DISCONNECTED';
  private qrCodeDataUrl: string | null = null;
  private qrCodeRaw: string | null = null;
  private botJid: string | null = null;
  private lastConnectedAt: Date | null = null;
  private isConnecting = false;
  private presenceTimer: NodeJS.Timeout | null = null;

  public getState(): WhatsAppState {
    return {
      status: this.status,
      qrCodeDataUrl: this.qrCodeDataUrl,
      qrCodeRaw: this.qrCodeRaw,
      botJid: this.botJid,
      lastConnectedAt: this.lastConnectedAt,
      targetGroupJid: config.targetGroupJid,
    };
  }

  public async start(): Promise<void> {
    if (this.isConnecting) {
      logger.info('WhatsApp já está em processo de conexão.');
      return;
    }

    this.isConnecting = true;
    this.setStatus('CONNECTING');

    try {
      const { version, isLatest } = await fetchLatestBaileysVersion();
      logger.info({ version, isLatest }, 'Iniciando WhatsApp Baileys...');

      const { state, saveCreds, clearSession } = await usePrismaAuthState('session_main');

      // Fecha socket anterior se existir
      if (this.sock) {
        try {
          this.sock.end(undefined);
        } catch {
          // ignore
        }
      }

      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: logger.child({ module: 'baileys' }) as any,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: true,
        keepAliveIntervalMs: 25000,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        retryRequestDelayMs: 2000,
      });

      this.sock = sock;

      // Evento de persistência de credenciais
      sock.ev.on('creds.update', saveCreds);

      // Evento de status da conexão
      sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrCodeRaw = qr;
          try {
            this.qrCodeDataUrl = await QRCode.toDataURL(qr, {
              margin: 2,
              width: 320,
              color: {
                dark: '#000000',
                light: '#ffffff',
              },
            });
          } catch (err) {
            logger.error({ err }, 'Erro ao gerar imagem DataURL do QR Code.');
          }

          this.setStatus('CONNECTING');
          logger.info('📱 Novo QR Code gerado para autenticação.');
        }

        if (connection === 'open') {
          this.setStatus('CONNECTED');
          this.qrCodeDataUrl = null;
          this.qrCodeRaw = null;
          this.lastConnectedAt = new Date();
          this.botJid = sock.user?.id || null;
          this.isConnecting = false;

          logger.info({ user: sock.user }, '✅ WhatsApp Conectado com Sucesso!');

          // Mantém presença ativa a cada 45 segundos
          if (this.presenceTimer) clearInterval(this.presenceTimer);
          this.presenceTimer = setInterval(async () => {
            try {
              if (this.status === 'CONNECTED' && this.sock) {
                await this.sock.sendPresenceUpdate('available');
              }
            } catch {
              // ignore
            }
          }, 45000);
        }

        if (connection === 'close') {
          this.isConnecting = false;
          this.qrCodeDataUrl = null;
          this.qrCodeRaw = null;
          if (this.presenceTimer) clearInterval(this.presenceTimer);

          const error = lastDisconnect?.error as Boom | undefined;
          const statusCode = error?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;

          logger.warn(
            { statusCode, isLoggedOut, reason: error?.message },
            '⚠️ Conexão do WhatsApp encerrada.'
          );

          if (isLoggedOut) {
            logger.warn('Usuário desconectou a sessão do WhatsApp. Limpando credenciais...');
            await clearSession();
            this.setStatus('DISCONNECTED');
            setTimeout(() => this.start(), 3000);
          } else {
            this.setStatus('DISCONNECTED');
            const retryDelay = 5000;
            logger.info(`Tentando reconectar em ${retryDelay / 1000}s...`);
            setTimeout(() => this.start(), retryDelay);
          }
        }
      });

      // Evento de mensagens recebidas
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        for (const msg of messages) {
          try {
            await handleIncomingMessage(sock, msg);
          } catch (err) {
            logger.error({ err }, 'Erro ao despachar mensagem recebida.');
          }
        }
      });
    } catch (error) {
      this.isConnecting = false;
      this.setStatus('DISCONNECTED');
      logger.error({ error }, 'Erro crítico ao inicializar socket Baileys.');
      setTimeout(() => this.start(), 10000);
    }
  }

  private setStatus(newStatus: WhatsAppConnectionStatus): void {
    this.status = newStatus;
    this.emit('stateChange', this.getState());
  }

  public async resetSession(): Promise<void> {
    logger.warn('🔄 Reiniciando sessão do WhatsApp e gerando novo QR Code...');
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {
        // ignore
      }
      this.sock = null;
    }
    const { clearSession } = await usePrismaAuthState('session_main');
    await clearSession();
    this.setStatus('DISCONNECTED');
    this.isConnecting = false;
    await this.start();
  }

  public getSocket(): WASocket | null {
    return this.sock;
  }
}

export const whatsAppService = new WhatsAppService();
