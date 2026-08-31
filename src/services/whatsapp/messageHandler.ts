import {
  downloadMediaMessage,
  proto,
  WASocket,
} from '@whiskeysockets/baileys';
import { config } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import {
  createTransaction,
  deleteTransaction,
  formatBRL,
  getMonthSummary,
  getRecentTransactions,
} from '../finance/transactionService.js';
import {
  extractFinancialDataFromAudio,
  extractFinancialDataFromText,
} from '../ai/gemini.js';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TIME_ZONE = 'America/Sao_Paulo';

// Armazena IDs de mensagens geradas pelo próprio bot para evitar loops infinitos
const botMessageIds = new Set<string>();

function recordBotMessageId(id?: string | null) {
  if (!id) return;
  botMessageIds.add(id);
  if (botMessageIds.size > 1000) {
    const firstKey = botMessageIds.values().next().value;
    if (firstKey) botMessageIds.delete(firstKey);
  }
}

async function sendBotReply(
  sock: WASocket,
  remoteJid: string,
  content: any,
  options?: any
) {
  const sent = await sock.sendMessage(remoteJid, content, options);
  if (sent?.key?.id) {
    recordBotMessageId(sent.key.id);
  }
  return sent;
}

/**
 * Formata data para o padrão brasileiro DD/MM/YYYY
 */
function formatDateBR(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const zoned = toZonedTime(d, TIME_ZONE);
  return format(zoned, 'dd/MM/yyyy');
}

/**
 * Manipulador principal de mensagens recebidas pelo Baileys
 */
export async function handleIncomingMessage(
  sock: WASocket,
  msg: proto.IWebMessageInfo
): Promise<void> {
  try {
    const msgId = msg.key?.id;
    if (msgId && botMessageIds.has(msgId)) {
      return;
    }

    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || remoteJid === 'status@broadcast') return;

    const messageContent = msg.message;
    if (!messageContent) return;

    // Extração de Texto
    const text =
      messageContent.conversation ||
      messageContent.extendedTextMessage?.text ||
      messageContent.imageMessage?.caption ||
      '';

    const trimmedText = text.trim();

    // Se a mensagem começar com os padrões de resposta do bot, ignora para evitar eco
    if (
      trimmedText.startsWith('✅ *Lançamento') ||
      trimmedText.startsWith('📊 *Resumo') ||
      trimmedText.startsWith('📑 *Últimos') ||
      trimmedText.startsWith('🗑️ *Lançamento') ||
      trimmedText.startsWith('🤖 *Guia') ||
      trimmedText.startsWith('⚠️') ||
      trimmedText.startsWith('ℹ️')
    ) {
      return;
    }

    // Se for mensagem de qualquer grupo (@g.us), registra com destaque no log
    if (remoteJid.endsWith('@g.us')) {
      logger.info(
        {
          groupJid: remoteJid,
          sender: msg.pushName || 'Você',
          text: trimmedText || (messageContent.audioMessage ? '[Áudio]' : '[Mídia]'),
          fromMe: msg.key.fromMe,
        },
        `📢 [MENSAGEM DE GRUPO] ID do Grupo: ${remoteJid}`
      );
    }

    // Filtro Estrito: Apenas processa se for exatamente o TARGET_GROUP_JID configurado
    if (!config.targetGroupJid || remoteJid !== config.targetGroupJid) {
      return;
    }

    // Extração de Áudio
    const isAudio = Boolean(messageContent.audioMessage);
    if (isAudio) {
      await handleAudioMessage(sock, msg);
      return;
    }

    if (!trimmedText) return;

    // Processamento de Comandos Rápidos
    const lower = trimmedText.toLowerCase();

    if (lower === '/saldo' || lower === '/resumo') {
      await handleSaldoCommand(sock, remoteJid, msg);
      return;
    }

    if (lower === '/extrato') {
      await handleExtratoCommand(sock, remoteJid, msg);
      return;
    }

    if (lower.startsWith('/deletar ') || lower.startsWith('/excluir ') || lower.startsWith('/del ')) {
      const parts = trimmedText.split(' ');
      const targetId = parts[1];
      await handleDeleteCommand(sock, remoteJid, targetId, msg);
      return;
    }

    if (lower === '/ajuda' || lower === '/help') {
      await handleAjudaCommand(sock, remoteJid, msg);
      return;
    }

    // Se não for comando, processa como texto financeiro via Gemini AI
    await handleTextMessageAI(sock, remoteJid, trimmedText, msg);
  } catch (error) {
    logger.error({ error }, 'Erro ao processar mensagem do WhatsApp.');
  }
}

/**
 * Responde ao comando /saldo ou /resumo
 */
async function handleSaldoCommand(
  sock: WASocket,
  remoteJid: string,
  quotedMsg: proto.IWebMessageInfo
): Promise<void> {
  const summary = await getMonthSummary();
  const balanceEmoji = summary.balance >= 0 ? '🟢' : '🔴';

  const replyText =
    `📊 *Resumo Financeiro do Mês*\n\n` +
    `🟢 *Receitas:* ${formatBRL(summary.totalIncome)}\n` +
    `🔴 *Despesas:* ${formatBRL(summary.totalExpense)}\n` +
    `💰 *Saldo Líquido:* ${balanceEmoji} *${formatBRL(summary.balance)}*\n\n` +
    `_Total de ${summary.count} lançamentos neste mês._`;

  await sendBotReply(sock, remoteJid, { text: replyText }, { quoted: quotedMsg });
}

/**
 * Responde ao comando /extrato
 */
async function handleExtratoCommand(
  sock: WASocket,
  remoteJid: string,
  quotedMsg: proto.IWebMessageInfo
): Promise<void> {
  const transactions = await getRecentTransactions(5);

  if (transactions.length === 0) {
    await sendBotReply(
      sock,
      remoteJid,
      { text: 'ℹ️ Nenhum lançamento encontrado no histórico.' },
      { quoted: quotedMsg }
    );
    return;
  }

  let text = `📑 *Últimos ${transactions.length} Lançamentos:*\n\n`;

  transactions.forEach((t, index) => {
    const isIncome = t.type === 'INCOME';
    const typeEmoji = isIncome ? '🟢' : '🔴';
    const shortId = t.id.substring(0, 8);
    const dateFormatted = formatDateBR(t.date);

    text += `${index + 1}. ${typeEmoji} *${t.description}* - ${formatBRL(t.amount)}\n`;
    text += `   🏷️ ${t.category} | 💳 ${t.paymentMethod}\n`;
    text += `   📅 ${dateFormatted} | 🆔 \`${shortId}\`\n\n`;
  });

  text += `_Para excluir algum lançamento, envie: /deletar ID_`;

  await sendBotReply(sock, remoteJid, { text: text.trim() }, { quoted: quotedMsg });
}

/**
 * Responde ao comando /deletar <ID>
 */
async function handleDeleteCommand(
  sock: WASocket,
  remoteJid: string,
  targetId: string | undefined,
  quotedMsg: proto.IWebMessageInfo
): Promise<void> {
  if (!targetId) {
    await sendBotReply(
      sock,
      remoteJid,
      { text: '⚠️ Por favor informe o ID da transação. Exemplo: `/deletar abcd1234`' },
      { quoted: quotedMsg }
    );
    return;
  }

  const deleted = await deleteTransaction(targetId);

  if (!deleted) {
    await sendBotReply(
      sock,
      remoteJid,
      { text: `⚠️ Nenhum lançamento ativo encontrado com o ID: \`${targetId}\`` },
      { quoted: quotedMsg }
    );
    return;
  }

  const summary = await getMonthSummary();
  const shortId = deleted.id.substring(0, 8);

  const replyText =
    `🗑️ *Lançamento Cancelado com Sucesso!*\n\n` +
    `📌 *Descrição:* ${deleted.description}\n` +
    `💰 *Valor:* ${formatBRL(deleted.amount)}\n` +
    `📅 *Data:* ${formatDateBR(deleted.date)}\n` +
    `🆔 \`${shortId}\`\n\n` +
    `Saldo atual do mês: *${formatBRL(summary.balance)}*`;

  await sendBotReply(sock, remoteJid, { text: replyText }, { quoted: quotedMsg });
}

/**
 * Responde ao comando /ajuda
 */
async function handleAjudaCommand(
  sock: WASocket,
  remoteJid: string,
  quotedMsg: proto.IWebMessageInfo
): Promise<void> {
  const replyText =
    `🤖 *Guia de Uso - Bot de Controle Financeiro*\n\n` +
    `Basta enviar uma mensagem de texto ou gravar um áudio normalmente no grupo! A IA entenderá os detalhes e salvará o lançamento.\n\n` +
    `✍️ *Exemplos de texto ou áudio:*\n` +
    `• _"Comprei 35 de padaria no débito"_\n` +
    `• _"Recebi 3500 do salário"_\n` +
    `• _"Conta de água 85 reais no pix"_\n` +
    `• _"Almoço 42 no crédito"_\n` +
    `• _"Gasolina 150 reais ontem"_\n\n` +
    `⚡ *Comandos Rápidos:*\n` +
    `• */saldo* ou */resumo* - Saldo e totais do mês\n` +
    `• */extrato* - Ver os últimos 5 lançamentos\n` +
    `• */deletar <ID>* - Cancelar um lançamento\n` +
    `• */ajuda* - Exibe este menu`;

  await sendBotReply(sock, remoteJid, { text: replyText }, { quoted: quotedMsg });
}

/**
 * Processa texto com o Gemini e persiste se for financeiro
 */
async function handleTextMessageAI(
  sock: WASocket,
  remoteJid: string,
  text: string,
  quotedMsg: proto.IWebMessageInfo
): Promise<void> {
  try {
    const aiResult = await extractFinancialDataFromText(text);

    if (!aiResult.is_financial_entry || !aiResult.amount) {
      return;
    }

    const transaction = await createTransaction({
      type: aiResult.type || 'EXPENSE',
      amount: aiResult.amount,
      category: aiResult.category || 'Outros',
      paymentMethod: aiResult.payment_method || 'Não especificado',
      description: aiResult.description || 'Lançamento',
      date: aiResult.date ? new Date(aiResult.date) : new Date(),
      rawMessage: text,
    });

    const summary = await getMonthSummary();
    const formattedDate = formatDateBR(transaction.date);
    const shortId = transaction.id.substring(0, 8);

    const confirmationMsg =
      `✅ *Lançamento Registrado!*\n\n` +
      `📌 *Descrição:* ${transaction.description}\n` +
      `💰 *Valor:* ${formatBRL(transaction.amount)}\n` +
      `🏷️ *Categoria:* ${transaction.category}\n` +
      `💳 *Pagamento:* ${transaction.paymentMethod}\n` +
      `📅 *Data:* ${formattedDate}\n` +
      `🆔 \`${shortId}\`\n\n` +
      `Saldo do mês: *${formatBRL(summary.balance)}*`;

    await sendBotReply(sock, remoteJid, { text: confirmationMsg }, { quoted: quotedMsg });
  } catch (error) {
    logger.error({ error, text }, 'Falha ao processar texto com Gemini.');
  }
}

/**
 * Processa áudio com o Gemini e persiste se for financeiro
 */
async function handleAudioMessage(
  sock: WASocket,
  msg: proto.IWebMessageInfo
): Promise<void> {
  const remoteJid = msg.key.remoteJid!;
  try {
    logger.info('🎙️ Mensagem de áudio detectada no grupo. Baixando buffer...');

    const buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger,
        reuploadRequest: sock.updateMediaMessage,
      }
    );

    if (!buffer || buffer.length === 0) {
      logger.warn('Buffer de áudio vazio ou não pôde ser baixado.');
      return;
    }

    const audioMimeType = msg.message?.audioMessage?.mimetype || 'audio/ogg; codecs=opus';
    const aiResult = await extractFinancialDataFromAudio(buffer as Buffer, audioMimeType);

    if (!aiResult.is_financial_entry || !aiResult.amount) {
      return;
    }

    const transaction = await createTransaction({
      type: aiResult.type || 'EXPENSE',
      amount: aiResult.amount,
      category: aiResult.category || 'Outros',
      paymentMethod: aiResult.payment_method || 'Não especificado',
      description: aiResult.description || 'Lançamento via Áudio',
      date: aiResult.date ? new Date(aiResult.date) : new Date(),
      rawMessage: '[Mensagem de Áudio]',
    });

    const summary = await getMonthSummary();
    const formattedDate = formatDateBR(transaction.date);
    const shortId = transaction.id.substring(0, 8);

    const confirmationMsg =
      `✅ *Lançamento Registrado (via Áudio)!*\n\n` +
      `📌 *Descrição:* ${transaction.description}\n` +
      `💰 *Valor:* ${formatBRL(transaction.amount)}\n` +
      `🏷️ *Categoria:* ${transaction.category}\n` +
      `💳 *Pagamento:* ${transaction.paymentMethod}\n` +
      `📅 *Data:* ${formattedDate}\n` +
      `🆔 \`${shortId}\`\n\n` +
      `Saldo do mês: *${formatBRL(summary.balance)}*`;

    await sendBotReply(sock, remoteJid, { text: confirmationMsg }, { quoted: msg });
  } catch (error) {
    logger.error({ error }, 'Falha ao processar áudio do WhatsApp com Gemini.');
  }
}
