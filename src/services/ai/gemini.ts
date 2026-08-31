import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { config } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

export interface FinancialExtractionResult {
  is_financial_entry: boolean;
  type?: 'INCOME' | 'EXPENSE';
  amount?: number;
  category?: string;
  payment_method?: string;
  description?: string;
  date?: string;
  reason?: string;
}

const financialSchema = {
  type: SchemaType.OBJECT,
  properties: {
    is_financial_entry: {
      type: SchemaType.BOOLEAN,
      description: 'Verdadeiro se a mensagem representa um lançamento financeiro (receita ou despesa). Falso se for apenas conversa, dúvida ou mensagem sem valor/gasto/ganho claro.',
    },
    type: {
      type: SchemaType.STRING,
      enum: ['INCOME', 'EXPENSE'],
      description: 'INCOME para entradas/receitas/ganhos e EXPENSE para saídas/despesas/gastos/compras.',
    },
    amount: {
      type: SchemaType.NUMBER,
      description: 'Valor numérico em reais (float/decimal positivo). Ex: 35.50',
    },
    category: {
      type: SchemaType.STRING,
      description: 'Categoria do lançamento baseada nas opções fornecidas.',
    },
    payment_method: {
      type: SchemaType.STRING,
      description: 'Forma de pagamento utilizada ou Não especificado.',
    },
    description: {
      type: SchemaType.STRING,
      description: 'Descrição curta, clara e padronizada do gasto ou receita. Ex: Padaria, Salário, Conta de Luz.',
    },
    date: {
      type: SchemaType.STRING,
      description: 'Data e hora do lançamento no formato ISO 8601.',
    },
  },
  required: ['is_financial_entry'],
};

function getSystemInstruction(): string {
  const now = new Date();
  const currentDateTimeIso = now.toISOString();
  const currentDateTimePtBr = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  return `Você é um assistente financeiro pessoal de alta precisão.
Sua tarefa é analisar mensagens de texto ou áudio e extrair transações financeiras em JSON rigoroso.

Data/hora atual de referência: ${currentDateTimePtBr} (${currentDateTimeIso}).
Se o usuário mencionar termos relativos (ex: "hoje", "ontem", "anteontem", "segunda-feira passada"), calcule a data correta baseando-se nessa data de referência. Se não mencionar data, utilize a data e hora atual.

Regras de Classificação:
1. Categorias válidas para EXPENSE (Despesas):
   - Alimentação (padaria, supermercado, restaurante, lanche, ifood, café, feira)
   - Transporte (combustível, uber, táxi, metrô, ônibus, estacionamento, pedágio, manutenção veículo)
   - Moradia (aluguel, condomínio, iptu, reforma, móveis)
   - Lazer (cinema, viagens, jogos, passeios, streaming, shows)
   - Saúde (farmácia, consultas, remédios, plano de saúde, dentista)
   - Educação (cursos, faculdade, livros, material escolar)
   - Compras (roupas, eletrônicos, presentes, compras pessoais)
   - Contas/Boletos (água, luz, internet, gás, telefone, taxas)
   - Outros (gastos diversos não contemplados)

2. Categorias válidas para INCOME (Receitas):
   - Salário
   - Rendimentos (investimentos, dividendos, juros)
   - Vendas
   - Freela
   - Reembolso
   - Outros

3. Formas de pagamento permitidas:
   - Dinheiro
   - Pix
   - Cartão de Crédito
   - Cartão de Débito
   - Boleto
   - Não especificado (quando não informado expressamente)

4. Se a mensagem NÃO contiver valor financeiro ou não for um lançamento, defina "is_financial_entry": false.`;
}

let genAIInstance: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!genAIInstance) {
    if (!config.geminiApiKey) {
      throw new Error('GEMINI_API_KEY não configurada no arquivo .env.');
    }
    genAIInstance = new GoogleGenerativeAI(config.geminiApiKey);
  }
  return genAIInstance;
}

/**
 * Processa texto informal e extrai o lançamento financeiro via Gemini AI
 */
export async function extractFinancialDataFromText(
  text: string
): Promise<FinancialExtractionResult> {
  try {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        // @ts-ignore
        responseSchema: financialSchema,
        temperature: 0.1,
      },
      systemInstruction: getSystemInstruction(),
    });

    const prompt = `Analise a mensagem de texto do usuário e extraia o lançamento financeiro:\n\n"${text}"`;
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    const parsed: FinancialExtractionResult = JSON.parse(responseText);
    return normalizeResult(parsed);
  } catch (error) {
    logger.error({ error, text }, 'Erro ao extrair dados financeiros do texto com Gemini.');
    throw error;
  }
}

/**
 * Processa áudio (Buffer de voz do WhatsApp) e extrai o lançamento financeiro
 */
export async function extractFinancialDataFromAudio(
  audioBuffer: Buffer,
  mimeType = 'audio/ogg; codecs=opus'
): Promise<FinancialExtractionResult> {
  try {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        // @ts-ignore
        responseSchema: financialSchema,
        temperature: 0.1,
      },
      systemInstruction: getSystemInstruction(),
    });

    const audioPart = {
      inlineData: {
        data: audioBuffer.toString('base64'),
        mimeType: mimeType.includes(';') ? mimeType.split(';')[0] : mimeType,
      },
    };

    const prompt = `Escute este áudio enviado pelo usuário no WhatsApp e extraia o lançamento financeiro mencionado com precisão.`;
    const result = await model.generateContent([prompt, audioPart]);
    const responseText = result.response.text();

    const parsed: FinancialExtractionResult = JSON.parse(responseText);
    return normalizeResult(parsed);
  } catch (error) {
    logger.error({ error, bufferLength: audioBuffer.length, mimeType }, 'Erro ao extrair dados financeiros do áudio com Gemini.');
    throw error;
  }
}

function normalizeResult(result: FinancialExtractionResult): FinancialExtractionResult {
  if (!result.is_financial_entry) {
    return { is_financial_entry: false };
  }

  // Garante que amount é numérico positivo
  let amount = typeof result.amount === 'number' ? Math.abs(result.amount) : 0;
  if (isNaN(amount) || amount <= 0) {
    return { is_financial_entry: false };
  }

  // Arredonda para 2 casas decimais
  amount = Math.round(amount * 100) / 100;

  // Garante data válida
  let dateStr = result.date;
  if (!dateStr || isNaN(new Date(dateStr).getTime())) {
    dateStr = new Date().toISOString();
  }

  return {
    is_financial_entry: true,
    type: result.type === 'INCOME' ? 'INCOME' : 'EXPENSE',
    amount,
    category: result.category || (result.type === 'INCOME' ? 'Outros' : 'Alimentação'),
    payment_method: result.payment_method || 'Não especificado',
    description: result.description || (result.type === 'INCOME' ? 'Receita' : 'Despesa'),
    date: dateStr,
  };
}
