import dotenv from 'dotenv';
import path from 'path';

// Carrega as variáveis de ambiente
dotenv.config();

export interface AppConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  geminiApiKey: string;
  targetGroupJid: string;
  adminWebToken: string;
  appUrl: string;
  keepAliveIntervalMinutes: number;
  dbKeepAliveIntervalMinutes: number;
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  targetGroupJid: (process.env.TARGET_GROUP_JID || '').trim(),
  adminWebToken: process.env.ADMIN_WEB_TOKEN || 'admin123',
  // URL da aplicação no Render ou customizada (Render fornece RENDER_EXTERNAL_URL automaticamente)
  appUrl: (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || '').trim(),
  keepAliveIntervalMinutes: parseInt(process.env.KEEP_ALIVE_INTERVAL_MINUTES || '10', 10),
  dbKeepAliveIntervalMinutes: parseInt(process.env.DB_KEEP_ALIVE_INTERVAL_MINUTES || '5', 10),
};

export function validateConfig(): void {
  const missing: string[] = [];

  if (!config.databaseUrl) {
    missing.push('DATABASE_URL');
  }

  if (!config.geminiApiKey) {
    console.warn('⚠️ AVISO: GEMINI_API_KEY não está configurada no .env. O processamento por IA não funcionará até que a chave seja informada.');
  }

  if (!config.targetGroupJid) {
    console.warn('⚠️ AVISO: TARGET_GROUP_JID não está configurada no .env. O bot não responderá a mensagens até que o JID do grupo seja definido.');
  }

  if (missing.length > 0) {
    console.warn(`⚠️ Configurações obrigatórias ausentes: ${missing.join(', ')}`);
  }
}
