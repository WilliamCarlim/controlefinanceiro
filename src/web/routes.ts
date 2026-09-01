import express, { Request, Response } from 'express';
import { config } from '../config/env.js';
import { whatsAppService, WhatsAppState } from '../services/whatsapp/baileysClient.js';
import { prisma } from '../lib/prisma.js';
import {
  getMonthSummary,
  getRecentTransactions,
  financialEvents,
  MonthSummary,
} from '../services/finance/transactionService.js';

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
 * Reinicia a sessão do WhatsApp e gera novo QR Code
 */
router.post('/api/reset-session', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Não autorizado.' });
    return;
  }
  try {
    await whatsAppService.resetSession();
    res.json({ success: true, message: 'Sessão reiniciada. Novo QR Code sendo gerado.' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Erro ao reiniciar sessão.' });
  }
});

router.get('/reset-session', async (req: Request, res: Response) => {
  const token = (req.query.token as string) || '';
  if (token !== config.adminWebToken) {
    res.status(401).send(renderUnauthorizedPage());
    return;
  }
  try {
    await whatsAppService.resetSession();
    res.redirect(`/?token=${encodeURIComponent(token)}`);
  } catch (err) {
    res.redirect(`/?token=${encodeURIComponent(token)}`);
  }
});

/**
 * Server-Sent Events (SSE) para atualização em tempo real do WhatsApp e dos lançamentos financeiros
 */
router.get('/api/events', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    res.status(401).send('Unauthorized');
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (payload: any) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const sendFinancialUpdate = async () => {
    try {
      const totalTransactions = await prisma.transaction.count({ where: { isDeleted: false } });
      const summary = await getMonthSummary();
      const recent = await getRecentTransactions(8);
      sendEvent({
        type: 'financialUpdate',
        totalTransactions,
        summary,
        recentTransactions: recent,
      });
    } catch {
      // ignore
    }
  };

  // Envia o estado inicial completo
  sendEvent({
    type: 'state',
    data: whatsAppService.getState(),
  });
  await sendFinancialUpdate();

  // Escuta alterações na conexão do WhatsApp
  const stateListener = (state: WhatsAppState) => {
    sendEvent({ type: 'state', data: state });
  };
  whatsAppService.on('stateChange', stateListener);

  // Escuta novas transações ou exclusões no banco
  const financialListener = async () => {
    await sendFinancialUpdate();
  };
  financialEvents.on('change', financialListener);

  req.on('close', () => {
    whatsAppService.off('stateChange', stateListener);
    financialEvents.off('change', financialListener);
  });
});

/**
 * Painel Web Principal
 */
router.get('/', async (req: Request, res: Response) => {
  const token = (req.query.token as string) || '';

  if (token !== config.adminWebToken) {
    res.status(401).send(renderUnauthorizedPage());
    return;
  }

  const state = whatsAppService.getState();
  let totalTransactions = 0;
  let summary: MonthSummary = {
    previousBalance: 0,
    monthIncome: 0,
    monthExpense: 0,
    monthNet: 0,
    totalBalance: 0,
    totalIncome: 0,
    totalExpense: 0,
    balance: 0,
    monthName: 'Mês Atual',
    year: new Date().getFullYear(),
    count: 0,
  };
  let recentTransactions: any[] = [];

  try {
    totalTransactions = await prisma.transaction.count({ where: { isDeleted: false } });
    summary = await getMonthSummary();
    recentTransactions = await getRecentTransactions(8);
  } catch (err) {
    // Ignora erro se o banco ainda estiver inicializando
  }

  res.send(renderDashboardHtml(state, token, totalTransactions, summary, recentTransactions));
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
    <p class="text-slate-400 text-sm mb-6">Informe o token de administrador para visualizar o painel.</p>
    
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
        class="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold rounded-xl text-sm transition-all duration-200 shadow-lg shadow-emerald-500/20 active:scale-[0.98]"
      >
        Acessar Painel
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
  summary: MonthSummary,
  recentTransactions: any[]
): string {
  const formatNum = (val: number) =>
    val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
    .stat-val { transition: all 0.3s ease-in-out; }
    @keyframes pulse-green {
      0%, 100% { background-color: rgba(16, 185, 129, 0.05); }
      50% { background-color: rgba(16, 185, 129, 0.2); }
    }
    .flash-update { animation: pulse-green 1s ease-in-out; }
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
          <p class="text-xs text-slate-400">Tempo Real • PostgreSQL • Gemini AI</p>
        </div>
      </div>
      
      <div class="flex items-center space-x-3">
        <div class="flex items-center space-x-2 text-xs text-emerald-400 font-mono mr-2 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
          <span>SSE Ativo</span>
        </div>

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
    <div id="stats-container" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
      <div class="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl">
        <span class="text-xs font-medium text-slate-400 block mb-1">Lançamentos</span>
        <span id="stat-total" class="text-2xl font-bold text-white stat-val">${totalTransactions}</span>
        <span id="stat-month-count" class="text-xs text-slate-500 block mt-1">${summary.count} em ${summary.monthName}</span>
      </div>
      <div class="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl">
        <span class="text-xs font-medium text-sky-400 block mb-1">Saldo Anterior</span>
        <span id="stat-prev-balance" class="text-2xl font-bold stat-val ${summary.previousBalance >= 0 ? 'text-sky-400' : 'text-rose-400'}">R$ ${formatNum(summary.previousBalance)}</span>
        <span id="stat-prev-label" class="text-xs text-slate-500 block mt-1">Até ${summary.monthName}</span>
      </div>
      <div class="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl">
        <span id="stat-income-label" class="text-xs font-medium text-emerald-400 block mb-1">Receitas (${summary.monthName})</span>
        <span id="stat-income" class="text-2xl font-bold text-emerald-400 stat-val">R$ ${formatNum(summary.monthIncome)}</span>
        <span class="text-xs text-slate-500 block mt-1">Ganhos do mês</span>
      </div>
      <div class="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl">
        <span id="stat-expense-label" class="text-xs font-medium text-rose-400 block mb-1">Despesas (${summary.monthName})</span>
        <span id="stat-expense" class="text-2xl font-bold text-rose-400 stat-val">R$ ${formatNum(summary.monthExpense)}</span>
        <span class="text-xs text-slate-500 block mt-1">Gastos do mês</span>
      </div>
      <div class="bg-slate-900/80 border border-emerald-500/30 bg-emerald-950/10 p-5 rounded-2xl shadow-lg shadow-emerald-950/20">
        <span class="text-xs font-semibold text-emerald-300 block mb-1">💰 Saldo Disponível</span>
        <span id="stat-balance" class="text-2xl font-black stat-val ${summary.totalBalance >= 0 ? 'text-emerald-400' : 'text-rose-400'}">R$ ${formatNum(summary.totalBalance)}</span>
        <span class="text-xs text-slate-400 block mt-1">Acumulado Geral</span>
      </div>
    </div>

    <!-- Main QR / Connection & Live Feed Box -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
      
      <!-- QR Code & Status Box (5 cols) -->
      <div class="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col items-center justify-center text-center shadow-xl relative overflow-hidden">
        
        <div id="view-connected" class="${state.status === 'CONNECTED' ? 'flex' : 'hidden'} flex-col items-center justify-center py-6 w-full">
          <div class="w-16 h-16 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center mb-4 border border-emerald-500/20 shadow-lg shadow-emerald-950/40">
            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
            </svg>
          </div>
          <h2 class="text-xl font-bold text-white mb-1">WhatsApp Conectado!</h2>
          <p class="text-slate-400 text-xs max-w-xs mb-4">
            Escutando mensagens de texto e áudio no seu grupo.
          </p>
          <div class="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-left w-full space-y-1 text-slate-300">
            <div><span class="text-slate-500">Target Group:</span> <span class="text-emerald-400">${state.targetGroupJid || 'Não configurado'}</span></div>
            <div><span class="text-slate-500">Banco:</span> <span class="text-emerald-400">PostgreSQL Conectado</span></div>
          </div>

          <button 
            onclick="resetSession()" 
            id="btn-reset"
            class="mt-4 inline-flex items-center px-4 py-2 border border-slate-700 hover:border-red-500/50 bg-slate-800 hover:bg-red-500/10 text-slate-300 hover:text-red-400 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer"
          >
            🔄 Desconectar e Gerar Novo QR Code
          </button>
        </div>

        <div id="view-qr" class="${state.status !== 'CONNECTED' ? 'flex' : 'hidden'} flex-col items-center justify-center py-4 w-full">
          <h2 class="text-xl font-bold text-white mb-2">Escaneie o QR Code</h2>
          <p class="text-slate-400 text-xs max-w-xs mb-4">
            Abra o WhatsApp > Aparelhos Conectados > Conectar um aparelho.
          </p>

          <div class="p-3 bg-white rounded-2xl shadow-2xl border-4 border-emerald-500/30 mb-4 flex items-center justify-center min-w-[280px] min-h-[280px]">
            <img 
              id="qr-image" 
              src="${state.qrCodeDataUrl || ''}" 
              alt="QR Code WhatsApp" 
              class="${state.qrCodeDataUrl ? 'block' : 'hidden'} w-64 h-64 rounded-lg"
            />
            <div id="qr-spinner" class="${state.qrCodeDataUrl ? 'hidden' : 'flex'} flex-col items-center justify-center text-slate-900 space-y-3">
              <svg class="animate-spin h-10 w-10 text-emerald-600" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span class="text-xs font-semibold text-slate-600">Gerando QR Code...</span>
            </div>
          </div>
          
          <p class="text-xs text-slate-500">Atualiza automaticamente em tempo real.</p>
        </div>

      </div>

      <!-- Live Feed of Recent Transactions (7 cols) -->
      <div class="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col">
        <div class="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
          <div class="flex items-center space-x-2">
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <h3 class="font-bold text-white text-base">Últimos Lançamentos (Tempo Real)</h3>
          </div>
          <span class="text-xs text-slate-500">Atualizado via SSE</span>
        </div>

        <div class="overflow-x-auto flex-1">
          <table class="w-full text-left text-xs">
            <thead>
              <tr class="text-slate-500 border-b border-slate-800/80">
                <th class="pb-2.5 font-medium">Descrição</th>
                <th class="pb-2.5 font-medium">Categoria / Pagamento</th>
                <th class="pb-2.5 font-medium">Data</th>
                <th class="pb-2.5 font-medium text-right">Valor</th>
              </tr>
            </thead>
            <tbody id="transactions-body" class="divide-y divide-slate-800/50">
              ${
                recentTransactions.length === 0
                  ? `<tr><td colspan="4" class="py-8 text-center text-slate-500">Nenhum lançamento registrado ainda.</td></tr>`
                  : recentTransactions
                      .map((t) => {
                        const isInc = t.type === 'INCOME';
                        const d = new Date(t.date).toLocaleDateString('pt-BR');
                        const shortId = t.id.substring(0, 8);
                        return `<tr class="hover:bg-slate-800/40 transition-colors">
                          <td class="py-3 font-semibold text-white flex items-center space-x-2">
                            <span>${isInc ? '🟢' : '🔴'}</span>
                            <span>${t.description}</span>
                            <code class="text-[10px] text-slate-500 bg-slate-950 px-1 py-0.5 rounded font-mono">${shortId}</code>
                          </td>
                          <td class="py-3 text-slate-400">
                            <span class="text-slate-300">${t.category}</span> • <span class="text-slate-500">${t.paymentMethod}</span>
                          </td>
                          <td class="py-3 text-slate-400">${d}</td>
                          <td class="py-3 text-right font-bold ${isInc ? 'text-emerald-400' : 'text-rose-400'}">
                            ${isInc ? '+' : '-'} R$ ${Number(t.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>`;
                      })
                      .join('')
              }
            </tbody>
          </table>
        </div>
      </div>

    </div>
  </main>

  <script>
    const token = '${token}';
    const evtSource = new EventSource('/api/events?token=' + encodeURIComponent(token));

    const badgeStatus = document.getElementById('badge-status');
    const badgeText = document.getElementById('badge-text');
    const viewConnected = document.getElementById('view-connected');
    const viewQr = document.getElementById('view-qr');
    const qrImage = document.getElementById('qr-image');
    const qrSpinner = document.getElementById('qr-spinner');

    const statTotal = document.getElementById('stat-total');
    const statMonthCount = document.getElementById('stat-month-count');
    const statPrevBalance = document.getElementById('stat-prev-balance');
    const statPrevLabel = document.getElementById('stat-prev-label');
    const statIncome = document.getElementById('stat-income');
    const statIncomeLabel = document.getElementById('stat-income-label');
    const statExpense = document.getElementById('stat-expense');
    const statExpenseLabel = document.getElementById('stat-expense-label');
    const statBalance = document.getElementById('stat-balance');
    const transactionsBody = document.getElementById('transactions-body');

    function formatBRL(val) {
      return (Number(val) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    evtSource.onmessage = function(event) {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'state') {
          updateWhatsAppUI(payload.data);
        } else if (payload.type === 'financialUpdate') {
          updateFinancialUI(payload);
        }
      } catch (err) {
        console.error('Erro ao processar evento SSE:', err);
      }
    };

    function updateWhatsAppUI(data) {
      if (data.status === 'CONNECTED') {
        badgeStatus.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/30';
        badgeText.textContent = 'Conectado';
        viewConnected.classList.remove('hidden');
        viewConnected.classList.add('flex');
        viewQr.classList.remove('flex');
        viewQr.classList.add('hidden');
      } else if (data.status === 'CONNECTING') {
        badgeStatus.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/30 animate-pulse';
        badgeText.textContent = 'Aguardando QR Code';
        viewConnected.classList.remove('flex');
        viewConnected.classList.add('hidden');
        viewQr.classList.remove('hidden');
        viewQr.classList.add('flex');

        if (data.qrCodeDataUrl) {
          qrImage.src = data.qrCodeDataUrl;
          qrImage.classList.remove('hidden');
          qrImage.classList.add('block');
          qrSpinner.classList.remove('flex');
          qrSpinner.classList.add('hidden');
        } else {
          qrImage.classList.remove('block');
          qrImage.classList.add('hidden');
          qrSpinner.classList.remove('hidden');
          qrSpinner.classList.add('flex');
        }
      } else {
        badgeStatus.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/30';
        badgeText.textContent = 'Desconectado';
        viewConnected.classList.remove('flex');
        viewConnected.classList.add('hidden');
        viewQr.classList.remove('hidden');
        viewQr.classList.add('flex');
        qrImage.classList.remove('block');
        qrImage.classList.add('hidden');
        qrSpinner.classList.remove('hidden');
        qrSpinner.classList.add('flex');
      }
    }

    function updateFinancialUI(payload) {
      const summary = payload.summary;
      const total = payload.totalTransactions;
      const recent = payload.recentTransactions || [];

      // Atualiza valores nos cards
      if (statTotal) statTotal.textContent = total;
      if (statMonthCount) statMonthCount.textContent = summary.count + ' em ' + summary.monthName;

      if (statPrevBalance) {
        statPrevBalance.textContent = 'R$ ' + formatBRL(summary.previousBalance);
        statPrevBalance.className = 'text-2xl font-bold stat-val ' + (summary.previousBalance >= 0 ? 'text-sky-400' : 'text-rose-400');
      }
      if (statPrevLabel) statPrevLabel.textContent = 'Até ' + summary.monthName;

      if (statIncome) statIncome.textContent = 'R$ ' + formatBRL(summary.monthIncome);
      if (statIncomeLabel) statIncomeLabel.textContent = 'Receitas (' + summary.monthName + ')';

      if (statExpense) statExpense.textContent = 'R$ ' + formatBRL(summary.monthExpense);
      if (statExpenseLabel) statExpenseLabel.textContent = 'Despesas (' + summary.monthName + ')';

      if (statBalance) {
        statBalance.textContent = 'R$ ' + formatBRL(summary.totalBalance);
        statBalance.className = 'text-2xl font-black stat-val ' + (summary.totalBalance >= 0 ? 'text-emerald-400' : 'text-rose-400');
      }

      // Efeito visual de flash nos cards
      const statsContainer = document.getElementById('stats-container');
      if (statsContainer) {
        statsContainer.classList.add('flash-update');
        setTimeout(() => statsContainer.classList.remove('flash-update'), 1000);
      }

      // Atualiza a tabela de lançamentos recentes
      if (transactionsBody) {
        if (recent.length === 0) {
          transactionsBody.innerHTML = '<tr><td colspan="4" class="py-8 text-center text-slate-500">Nenhum lançamento registrado ainda.</td></tr>';
        } else {
          transactionsBody.innerHTML = recent.map(t => {
            const isInc = t.type === 'INCOME';
            const d = new Date(t.date).toLocaleDateString('pt-BR');
            const shortId = (t.id || '').substring(0, 8);
            return '<tr class="hover:bg-slate-800/40 transition-colors animate-fade-in">' +
              '<td class="py-3 font-semibold text-white flex items-center space-x-2">' +
                '<span>' + (isInc ? '🟢' : '🔴') + '</span>' +
                '<span>' + t.description + '</span>' +
                '<code class="text-[10px] text-slate-500 bg-slate-950 px-1 py-0.5 rounded font-mono">' + shortId + '</code>' +
              '</td>' +
              '<td class="py-3 text-slate-400">' +
                '<span class="text-slate-300">' + t.category + '</span> • <span class="text-slate-500">' + t.paymentMethod + '</span>' +
              '</td>' +
              '<td class="py-3 text-slate-400">' + d + '</td>' +
              '<td class="py-3 text-right font-bold ' + (isInc ? 'text-emerald-400' : 'text-rose-400') + '">' +
                (isInc ? '+' : '-') + ' R$ ' + formatBRL(t.amount) +
              '</td>' +
            '</tr>';
          }).join('');
        }
      }
    }

    async function resetSession() {
      if (!confirm('Deseja desconectar a sessão atual e gerar um novo QR Code?')) return;
      const btn = document.getElementById('btn-reset');
      if (btn) btn.textContent = '🔄 Desconectando...';
      try {
        await fetch('/api/reset-session?token=' + encodeURIComponent(token), { method: 'POST' });
      } catch (err) {
        console.error('Erro ao reiniciar sessão:', err);
      }
    }
  </script>
</body>
</html>`;
}
