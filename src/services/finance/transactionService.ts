import { Prisma, Transaction, TransactionType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TIME_ZONE = 'America/Sao_Paulo';

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
  totalIncome: number;
  totalExpense: number;
  balance: number;
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

  const transactions = await prisma.transaction.findMany({
    where: {
      isDeleted: false,
      date: {
        gte: start,
        lte: end,
      },
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

  const balance = totalIncome - totalExpense;
  const monthName = format(zonedDate, 'MMMM', { locale: undefined });
  const year = zonedDate.getFullYear();

  return {
    totalIncome,
    totalExpense,
    balance,
    monthName,
    year,
    count: transactions.length,
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

  // Busca por id exato ou correspondência de prefixo (primeiros 8 caracteres de UUID)
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
