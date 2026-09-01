import { Prisma, Transaction, TransactionType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { startOfMonth, endOfMonth, startOfDay, endOfDay, subDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TIME_ZONE = 'America/Sao_Paulo';

export const MONTH_NAMES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

export interface CreateTransactionDTO {
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  category: string;
  paymentMethod?: string;
  description: string;
  date?: Date | string;
  rawMessage?: string;
}

export interface MonthSummary {
  previousBalance: number; // Saldo acumulado dos meses anteriores
  monthIncome: number;     // Receitas do mês atual
  monthExpense: number;    // Despesas do mês atual
  monthNet: number;        // Resultado líquido do mês (monthIncome - monthExpense)
  totalBalance: number;    // Saldo Total Disponível Acumulado (previousBalance + monthNet)
  totalIncome: number;     // Alias para monthIncome
  totalExpense: number;    // Alias para monthExpense
  balance: number;         // Alias para totalBalance
  monthName: string;
  year: number;
  count: number;
}

export interface StatementData {
  periodLabel: string;
  transactions: Transaction[];
  totalIncome: number;
  totalExpense: number;
  net: number;
}

export function formatBRL(value: number | Prisma.Decimal): string {
  const num = typeof value === 'number' ? value : Number(value);
  return num.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export async function createTransaction(
  data: CreateTransactionDTO
): Promise<Transaction> {
  const dateValue = data.date
    ? typeof data.date === 'string'
      ? new Date(data.date)
      : data.date
    : new Date();

  const transaction = await prisma.transaction.create({
    data: {
      type: data.type === 'INCOME' ? TransactionType.INCOME : TransactionType.EXPENSE,
      amount: new Prisma.Decimal(data.amount),
      category: data.category,
      paymentMethod: data.paymentMethod || 'Não especificado',
      description: data.description,
      date: dateValue,
      rawMessage: data.rawMessage,
    },
  });

  logger.info(
    {
      id: transaction.id,
      type: transaction.type,
      amount: data.amount,
      category: transaction.category,
    },
    '💾 Transação criada no banco de dados com sucesso.'
  );

  return transaction;
}

export async function getMonthSummary(targetDate = new Date()): Promise<MonthSummary> {
  const zonedDate = toZonedTime(targetDate, TIME_ZONE);
  const start = startOfMonth(zonedDate);
  const end = endOfMonth(zonedDate);

  // Busca todas as transações ativas até o fim do mês em questão
  const allTransactions = await prisma.transaction.findMany({
    where: {
      isDeleted: false,
      date: {
        lte: end,
      },
    },
  });

  let previousBalance = 0;
  let monthIncome = 0;
  let monthExpense = 0;
  let currentMonthCount = 0;

  for (const t of allTransactions) {
    const amt = Number(t.amount);
    const isIncome = t.type === TransactionType.INCOME;
    const txDate = new Date(t.date);

    if (txDate < start) {
      // Pertence a meses anteriores
      previousBalance += isIncome ? amt : -amt;
    } else {
      // Pertence ao mês atual
      currentMonthCount++;
      if (isIncome) {
        monthIncome += amt;
      } else {
        monthExpense += amt;
      }
    }
  }

  const monthNet = monthIncome - monthExpense;
  const totalBalance = previousBalance + monthNet;
  const monthName = MONTH_NAMES_PT[zonedDate.getMonth()] || 'Mês';
  const year = zonedDate.getFullYear();

  return {
    previousBalance,
    monthIncome,
    monthExpense,
    monthNet,
    totalBalance,
    totalIncome: monthIncome,
    totalExpense: monthExpense,
    balance: totalBalance,
    monthName,
    year,
    count: currentMonthCount,
  };
}

export async function getRecentTransactions(limit = 5): Promise<Transaction[]> {
  return prisma.transaction.findMany({
    where: {
      isDeleted: false,
    },
    orderBy: {
      date: 'desc',
    },
    take: limit,
  });
}

/**
 * Busca extrato por período (padrão: últimos 30 dias ou mês/ano específico como 08/2026)
 */
export async function getStatement(param?: string): Promise<StatementData> {
  const now = new Date();
  const zonedNow = toZonedTime(now, TIME_ZONE);
  let startDate: Date;
  let endDate: Date;
  let periodLabel: string;

  const cleanParam = (param || '').trim().toLowerCase();

  if (!cleanParam) {
    // Últimos 30 dias por padrão
    startDate = startOfDay(subDays(zonedNow, 30));
    endDate = endOfDay(zonedNow);
    periodLabel = 'Últimos 30 Dias';
  } else {
    // Tenta formato MM/YYYY, MM/YY, M/YYYY, MM-YYYY ou apenas MM
    const slashMatch = cleanParam.match(/^(\d{1,2})[\/\-](\d{2,4})$/);
    const monthOnlyMatch = cleanParam.match(/^(\d{1,2})$/);

    let targetMonth: number | null = null;
    let targetYear: number = zonedNow.getFullYear();

    if (slashMatch) {
      targetMonth = parseInt(slashMatch[1], 10);
      let rawYear = parseInt(slashMatch[2], 10);
      if (rawYear < 100) rawYear += 2000; // ex: 26 -> 2026
      targetYear = rawYear;
    } else if (monthOnlyMatch) {
      targetMonth = parseInt(monthOnlyMatch[1], 10);
    } else {
      // Tenta nome do mês em português (ex: agosto, set, etc)
      const monthIdx = MONTH_NAMES_PT.findIndex((m) =>
        m.toLowerCase().startsWith(cleanParam.slice(0, 3))
      );
      if (monthIdx !== -1) {
        targetMonth = monthIdx + 1;
      }
    }

    if (!targetMonth || targetMonth < 1 || targetMonth > 12) {
      // Se não reconheceu o formato, busca 30 dias
      startDate = startOfDay(subDays(zonedNow, 30));
      endDate = endOfDay(zonedNow);
      periodLabel = 'Últimos 30 Dias';
    } else {
      const monthDate = new Date(targetYear, targetMonth - 1, 1);
      startDate = startOfMonth(monthDate);
      endDate = endOfMonth(monthDate);
      const mName = MONTH_NAMES_PT[targetMonth - 1];
      periodLabel = `${mName}/${targetYear}`;
    }
  }

  const transactions = await prisma.transaction.findMany({
    where: {
      isDeleted: false,
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: {
      date: 'desc',
    },
  });

  let totalIncome = 0;
  let totalExpense = 0;

  for (const t of transactions) {
    const amt = Number(t.amount);
    if (t.type === TransactionType.INCOME) {
      totalIncome += amt;
    } else {
      totalExpense += amt;
    }
  }

  const net = totalIncome - totalExpense;

  return {
    periodLabel,
    transactions,
    totalIncome,
    totalExpense,
    net,
  };
}

export async function deleteTransaction(
  idOrPrefix: string
): Promise<Transaction | null> {
  const cleanId = idOrPrefix.trim();
  if (!cleanId) return null;

  const transaction = await prisma.transaction.findFirst({
    where: {
      isDeleted: false,
      OR: [
        { id: cleanId },
        { id: { startsWith: cleanId } },
      ],
    },
  });

  if (!transaction) {
    return null;
  }

  const updated = await prisma.transaction.update({
    where: { id: transaction.id },
    data: { isDeleted: true },
  });

  logger.info({ id: updated.id }, '🗑️ Transação marcada como excluída.');
  return updated;
}
