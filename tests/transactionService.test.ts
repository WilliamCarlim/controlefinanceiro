import { describe, it, expect, vi } from 'vitest';
import { formatBRL, createTransaction, getMonthSummary, deleteTransaction, getRecentTransactions } from '../src/services/finance/transactionService.js';
import { prisma } from '../src/lib/prisma.js';
import { Prisma } from '@prisma/client';

describe('Transaction Service', () => {
  describe('formatBRL', () => {
    it('deve formatar valores monetários em padrão BRL corretamente', () => {
      const formatted = formatBRL(35.5);
      expect(formatted).toContain('35,50');
      expect(formatted).toContain('R$');
    });

    it('deve aceitar Decimal do Prisma', () => {
      const formatted = formatBRL(new Prisma.Decimal(1250.99));
      expect(formatted).toContain('1.250,99');
    });
  });

  describe('CRUD de Transações (Mock)', () => {
    it('deve criar uma transação com os campos corretos', async () => {
      const mockTx = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        type: 'EXPENSE',
        amount: new Prisma.Decimal(35.0),
        category: 'Alimentação',
        paymentMethod: 'Débito',
        description: 'Padaria',
        date: new Date('2026-08-31T12:00:00Z'),
        rawMessage: 'Comprei 35 de padaria no débito',
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.spyOn(prisma.transaction, 'create').mockResolvedValue(mockTx as any);

      const result = await createTransaction({
        type: 'EXPENSE',
        amount: 35.0,
        category: 'Alimentação',
        paymentMethod: 'Débito',
        description: 'Padaria',
        rawMessage: 'Comprei 35 de padaria no débito',
      });

      expect(result.id).toBe(mockTx.id);
      expect(result.description).toBe('Padaria');
      expect(Number(result.amount)).toBe(35.0);
    });

    it('deve calcular o resumo do mês com saldo anterior e saldo acumulado', async () => {
      const mockList = [
        {
          id: 'prev-1',
          type: 'INCOME',
          amount: new Prisma.Decimal(3000.0),
          date: new Date('2026-08-28T10:00:00Z'), // Salário do mês anterior
          isDeleted: false,
        },
        {
          id: 'prev-2',
          type: 'EXPENSE',
          amount: new Prisma.Decimal(1000.0),
          date: new Date('2026-08-29T10:00:00Z'), // Gasto do mês anterior
          isDeleted: false,
        },
        {
          id: 'curr-1',
          type: 'EXPENSE',
          amount: new Prisma.Decimal(200.0),
          date: new Date('2026-09-01T10:00:00Z'), // Gasto no mês atual
          isDeleted: false,
        },
      ];

      vi.spyOn(prisma.transaction, 'findMany').mockResolvedValue(mockList as any);

      const summary = await getMonthSummary(new Date('2026-09-01T12:00:00Z'));

      expect(summary.previousBalance).toBe(2000); // 3000 - 1000
      expect(summary.monthIncome).toBe(0);
      expect(summary.monthExpense).toBe(200);
      expect(summary.monthNet).toBe(-200);
      expect(summary.totalBalance).toBe(1800); // 2000 - 200
      expect(summary.count).toBe(1);
    });

    it('deve buscar os últimos lançamentos ordenados por data desc', async () => {
      const mockList = [
        { id: '1', description: 'Item 1' },
        { id: '2', description: 'Item 2' },
      ];

      vi.spyOn(prisma.transaction, 'findMany').mockResolvedValue(mockList as any);

      const result = await getRecentTransactions(5);
      expect(result.length).toBe(2);
    });

    it('deve deletar transação buscando por prefixo do ID', async () => {
      const mockTx = {
        id: 'abcd1234-5678-90ab-cdef-1234567890ab',
        description: 'Padaria',
        amount: new Prisma.Decimal(35.0),
        date: new Date(),
        isDeleted: false,
      };

      vi.spyOn(prisma.transaction, 'findFirst').mockResolvedValue(mockTx as any);
      vi.spyOn(prisma.transaction, 'update').mockResolvedValue({ ...mockTx, isDeleted: true } as any);

      const deleted = await deleteTransaction('abcd1234');
      expect(deleted).not.toBeNull();
      expect(deleted?.isDeleted).toBe(true);
    });
  });
});
