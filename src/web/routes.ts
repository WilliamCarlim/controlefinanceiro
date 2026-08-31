import express, { Request, Response } from 'express';
import { config } from '../config/env.js';
import { whatsAppService, WhatsAppState } from '../services/whatsapp/baileysClient.js';
import { prisma } from '../lib/prisma.js';
import { getMonthSummary } from '../services/finance/transactionService.js';

export const router = express.Router();

function isAuthorized(req: Request): boolean {
  const token = req.query.token || req.headers['x-admin-token'];
  return token === config.adminWebToken;
}

/**
 * Health check para Render e serviços de monitoramento
 */
router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * API JSON de status
 */
router.get('/api/status', (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Token de administração inválido ou não fornecido.' });
    return;
  }
  res.json(whatsAppService.getState());
});

/**
 * Server-Sent Events (SSE) para atualização do QR Code e status em tempo real
 */
router.get('/api/events', (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    res.status(401).send('Unauthorized');
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendState = (state: WhatsAppState) => {
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  };

  // Envia o estado atual imediatamente
  sendState(whatsAppService.getState());

  const listener = (state: WhatsAppState) => {
    sendState(state);
  };

  whatsAppService.on('stateChange', listener);

  req.on('close', () => {
    whatsAppService.off('stateChange', listener);
  });
});

/**
 * Painel Web Principal (HTML com UI moderna, status e QR Code em tempo real)
 */
router.get('/', async (req: Request, res: Response) => {
  const token = (req.query.token as string) || '';

  if (token !== config.adminWebToken) {
    res.status(401).send(renderUnauthorizedPage());
    return;
  }

  const state = whatsAppService.getState();
  let totalTransactions = 0;
  let currentMonthSummary = { balance: 0, totalIncome: 0, totalExpense: 0 };

  try {
    totalTransactions = await prisma.transaction.count({ where: { isDeleted: false } });
    const summary = await getMonthSummary();
    currentMonthSummary = {
      balance: summary.balance,
      totalIncome: summary.totalIncome,
      totalExpense: summary.totalExpense,
    };
  } catch (err) {
    // Ignora erro se o banco ainda estiver inicializando
  }

  res.send(renderDashboardHtml(state, token, totalTransactions, currentMonthSummary));
});

function renderUnauthorizedPage(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Acesso Protegido - Bot Financeiro</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex items-center justify-center p-4">
  <div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl text-center">
    <div class="w-16 h-16 bg-red-500/10 text-red-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-500/20">
      <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
      </svg>
    </div>
    <h1 class="text-2xl font-bold text-white mb-2">Acesso Restrito</h1>
    <p class="text-slate-400 text-sm mb-6">Informe o token de administrador para visualizar o QR Code e o painel do WhatsApp.</p>
    
    <form method="GET" action="/" class="space-y-4">
      <div>
        <input 
          type="password" 
          name="token" 
          placeholder="Digite seu ADMIN_WEB_TOKEN" 
          required 
          class="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm"
        />
      </div>
      <button 
        type="submit" 
        class="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl transition duration-200 shadow-lg shadow-emerald-900/30 text-sm"
      >
        Entrar no Painel
      </button>
    </form>
  </div>
</body>
</html>`;
}

function renderDashboardHtml(
  state: WhatsAppState,
  token: string,
  totalTransactions: number,
  summary: { balance: number; totalIncome: number; totalExpense: number }
): string {
  return `<!DOCTYPE html>
<html lang="pt-BR" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Controle Financeiro - WhatsApp Bot</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
  <!-- Top Navigation -->
  <header class="border-b border-slate-800/80 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-950">
          <span class="text-xl">💰</span>
        </div>
        <div>
          <h1 class="font-bold text-white leading-tight">FinançasBot WhatsApp</h1>
          <p class="text-xs text-slate-400">Baileys + Gemini AI + PostgreSQL</p>
        </div>
      </div>
      
      <div class="flex items-center space-x-3">
        <span id="badge-status" class="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${
          state.status === 'CONNECTED'
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
            : state.status === 'CONNECTING'
            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30 animate-pulse'
            : 'bg-red-500/10 text-red-400 border border-red-500/30'
        }">
          <span class="w-2 h-2 rounded-full mr-2 ${
            state.status === 'CONNECTED' ? 'bg-emerald-400' : state.status === 'CONNECTING' ? 'bg-amber-400' : 'bg-red-400'
          }"></span>
          <span id="badge-text">${
            state.status === 'CONNECTED'
              ? 'Conectado'
              : state.status === 'CONNECTING'
              ? 'Aguardando QR Code'
              : 'Desconectado'
          }</span>
        </span>
      </div>
    </div>
  </header>

  <main class="max-w-6xl mx-auto px-4 sm:px-6 py-8">
    <!-- Stat Cards -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
      <div class="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl">
        <span class="text-xs font-medium text-slate-400 block mb-1">Total de Lançamentos</span>
        <span class="text-2xl font-bold text-white">${totalTransactions}</span>
      </div>
      <div class="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl">
        <span class="text-xs font-medium text-emerald-400 block mb-1">Receitas do Mês</span>
        <span class="text-2xl font-bold text-emerald-400">R$ ${summary.totalIncome.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
      </div>
      <div class="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl">
        <span class="text-xs font-medium text-rose-400 block mb-1">Despesas do Mês</span>
        <span class="text-2xl font-bold text-rose-400">R$ ${summary.totalExpense.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
      </div>
      <div class="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl">
        <span class="text-xs font-medium text-slate-400 block mb-1">Saldo Líquido</span>
        <span class="text-2xl font-bold ${summary.balance >= 0 ? 'text-emerald-400' : 'text-rose-400'}">R$ ${summary.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
      </div>
    </div>

    <!-- Main QR / Connection Box -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <!-- QR Code & Status Box (7 cols) -->
      <div class="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col items-center justify-center text-center shadow-xl relative overflow-hidden">
        
        <div id="view-connected" class="${state.status === 'CONNECTED' ? 'flex' : 'hidden'} flex-col items-center justify-center py-8">
          <div class="w-20 h-20 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center mb-6 border border-emerald-500/20 shadow-lg shadow-emerald-950/40">
            <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
            </svg>
          </div>
          <h2 class="text-2xl font-bold text-white mb-2">WhatsApp Conectado com Sucesso!</h2>
          <p class="text-slate-400 text-sm max-w-md mb-6">
            O bot está ativo e escutando mensagens de texto e áudio no grupo configurado.
          </p>
          <div class="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-left w-full max-w-md space-y-2 text-slate-300">
            <div><span class="text-slate-500">Target Group:</span> <span class="text-emerald-400">${state.targetGroupJid || 'Não configurado'}</span></div>
            <div><span class="text-slate-500">Status da Sessão:</span> <span class="text-emerald-400">Persistida no PostgreSQL</span></div>
          </div>
        </div>

        <div id="view-qr" class="${state.status !== 'CONNECTED' ? 'flex' : 'hidden'} flex-col items-center justify-center py-4">
          <h2 class="text-2xl font-bold text-white mb-2">Escaneie o QR Code</h2>
          <p class="text-slate-400 text-sm max-w-md mb-6">
            Abra o WhatsApp no celular > <strong class="text-white">Aparelhos Conectados</strong> > <strong class="text-white">Conectar um aparelho</strong> e aponte para a tela.
          </p>

          <div class="p-4 bg-white rounded-2xl shadow-2xl border-4 border-emerald-500/30 mb-6 flex items-center justify-center min-w-[320px] min-h-[320px]">
            <img 
              id="qr-img" 
              src="${state.qrCodeDataUrl || ''}" 
              alt="QR Code WhatsApp" 
              class="${state.qrCodeDataUrl ? 'block' : 'hidden'} w-72 h-72 rounded-lg"
            />
            <div id="qr-loading" class="${state.qrCodeDataUrl ? 'hidden' : 'flex'} flex-col items-center justify-center text-slate-600 p-8 space-y-3">
              <svg class="animate-spin h-8 w-8 text-emerald-600" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span class="text-sm font-medium">Aguardando geração do QR Code...</span>
            </div>
          </div>

          <p class="text-xs text-slate-500">Este QR Code atualiza automaticamente em tempo real sem necessidade de recarregar a página.</p>
        </div>

      </div>

      <!-- Quick Instructions & Configs (5 cols) -->
      <div class="lg:col-span-5 space-y-6">
        <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
          <h3 class="text-lg font-bold text-white mb-4 flex items-center">
            <span class="w-2 h-2 rounded-full bg-emerald-400 mr-2"></span>
            Como usar no Grupo
          </h3>
          <div class="space-y-4 text-sm text-slate-300">
            <div class="p-3 bg-slate-950 rounded-xl border border-slate-800/80">
              <p class="font-semibold text-emerald-400 mb-1">1. Lançamentos por Texto ou Áudio</p>
              <p class="text-xs text-slate-400">Envie mensagens normais como <em>"Comprei 35 de padaria no débito"</em> ou grave uma nota de voz.</p>
            </div>

            <div class="p-3 bg-slate-950 rounded-xl border border-slate-800/80">
              <p class="font-semibold text-emerald-400 mb-1">2. Comandos Rápidos</p>
              <ul class="text-xs text-slate-400 space-y-1 font-mono">
                <li><strong class="text-slate-200">/saldo</strong> ou <strong class="text-slate-200">/resumo</strong> - Totais do mês</li>
                <li><strong class="text-slate-200">/extrato</strong> - Ver últimos 5 lançamentos</li>
                <li><strong class="text-slate-200">/deletar &lt;ID&gt;</strong> - Cancelar lançamento</li>
                <li><strong class="text-slate-200">/ajuda</strong> - Menu de comandos</li>
              </ul>
            </div>

            <div class="p-3 bg-slate-950 rounded-xl border border-slate-800/80">
              <p class="font-semibold text-emerald-400 mb-1">3. Segurança e Grupo Privado</p>
              <p class="text-xs text-slate-400">O bot só processa mensagens originadas no grupo cujo JID está configurado em <code class="text-emerald-400 font-mono">TARGET_GROUP_JID</code>.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>

  <script>
    const token = '${token}';
    const evtSource = new EventSource('/api/events?token=' + encodeURIComponent(token));

    evtSource.onmessage = function(event) {
      try {
        const state = JSON.parse(event.data);
        const viewConnected = document.getElementById('view-connected');
        const viewQr = document.getElementById('view-qr');
        const qrImg = document.getElementById('qr-img');
        const qrLoading = document.getElementById('qr-loading');
        const badgeStatus = document.getElementById('badge-status');
        const badgeText = document.getElementById('badge-text');

        if (state.status === 'CONNECTED') {
          viewConnected.classList.remove('hidden');
          viewConnected.classList.add('flex');
          viewQr.classList.add('hidden');
          viewQr.classList.remove('flex');

          badgeStatus.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/30';
          badgeText.textContent = 'Conectado';
        } else {
          viewConnected.classList.add('hidden');
          viewConnected.classList.remove('flex');
          viewQr.classList.remove('hidden');
          viewQr.classList.add('flex');

          if (state.qrCodeDataUrl) {
            qrImg.src = state.qrCodeDataUrl;
            qrImg.classList.remove('hidden');
            qrImg.classList.add('block');
            qrLoading.classList.add('hidden');
            qrLoading.classList.remove('flex');
          } else {
            qrImg.classList.add('hidden');
            qrImg.classList.remove('block');
            qrLoading.classList.remove('hidden');
            qrLoading.classList.add('flex');
          }

          badgeStatus.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/30 animate-pulse';
          badgeText.textContent = state.status === 'CONNECTING' ? 'Aguardando QR Code' : 'Desconectado';
        }
      } catch (err) {
        console.error('Erro ao processar evento SSE:', err);
      }
    };
  </script>
</body>
</html>`;
}
