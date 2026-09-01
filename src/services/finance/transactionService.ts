import { Prisma, Transaction, TransactionType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { startOfMonth, endOfMonth } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TIME_ZONE = 'America/Sao_Paulo';

const MONTH_NAMES_PT = [
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
