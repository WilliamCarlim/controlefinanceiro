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
      description: 'Verdadeiro se a mensagem representa um lançamento financeiro (receita ou despesa). Falso se for apenas conversa, saudação ou sem valor.',
    },
    type: {
      type: SchemaType.STRING,
      enum: ['INCOME', 'EXPENSE'],
      description: 'INCOME para entradas/receitas/ganhos/depósitos e EXPENSE para saídas/despesas/gastos/compras/pagamentos.',
    },
    amount: {
      type: SchemaType.NUMBER,
      description: 'Valor numérico em reais (float/decimal positivo). Ex: 25.43',
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
      description: 'Descrição curta, clara e padronizada do gasto ou receita. Ex: Padaria, Salário, Depósito, Pix Recebido.',
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
   - Transporte (combustível, gasolina, uber, táxi, metrô, ônibus, estacionamento, pedágio, manutenção)
   - Moradia (aluguel, condomínio, iptu, reforma, móveis)
   - Lazer (cinema, viagens, jogos, passeios, streaming, shows)
   - Saúde (farmácia, consultas, remédios, plano de saúde, dentista)
   - Educação (cursos, faculdade, livros, material escolar)
   - Compras (roupas, eletrônicos, presentes, compras pessoais)
   - Contas/Boletos (água, luz, internet, gás, telefone, taxas)
   - Outros (gastos diversos)

2. Categorias válidas para INCOME (Receitas/Entradas):
   - Salário
   - Rendimentos (investimentos, dividendos, juros)
   - Vendas
   - Freela
   - Reembolso
   - Depósito (depósitos em conta, transferências recebidas)
   - Outros

3. Formas de pagamento permitidas:
   - Dinheiro
   - Pix
   - Cartão de Crédito
   - Cartão de Débito
   - Boleto
   - Não especificado

4. Se a mensagem NÃO contiver valor financeiro ou for apenas uma saudação (ex: "oi", "bom dia"), defina "is_financial_entry": false.`;
}

let genAIInstance: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI | null {
  if (!config.geminiApiKey || config.geminiApiKey.startsWith('AIzaSy...') || config.geminiApiKey.trim() === '') {
    return null;
  }
  if (!genAIInstance) {
    genAIInstance = new GoogleGenerativeAI(config.geminiApiKey.trim());
  }
  return genAIInstance;
}

/**
 * Tenta fazer o parse de JSON mesmo se a IA retornar com markdown ```json ... ```
 */
function cleanAndParseJSON(rawText: string): any {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();
  }
  return JSON.parse(cleaned);
}

/**
 * Extrator heurístico de contingência para português brasileiro
 * Usado se a chave do Gemini não estiver configurada ou se a API estiver fora do ar.
 */
function fallbackExtract(text: string): FinancialExtractionResult {
  const clean = text.toLowerCase().trim();

  // Procura valores no formato: 25,43 / 25.43 / 25 reais / R$ 25,43 / R$25
  const amountMatch = clean.match(/(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)(?:\s*(?:reais|real|conto))?/i);
  if (!amountMatch) {
    return { is_financial_entry: false };
  }

  const rawNum = amountMatch[1].replace(',', '.');
  const amount = parseFloat(rawNum);
  if (isNaN(amount) || amount <= 0) {
    return { is_financial_entry: false };
  }

  // Detecta se é receita ou despesa
  const isIncome =
    clean.includes('recebi') ||
    clean.includes('ganhei') ||
    clean.includes('salario') ||
    clean.includes('salário') ||
    clean.includes('deposito') ||
    clean.includes('depósito') ||
    clean.includes('rendimento') ||
    clean.includes('vendi') ||
    clean.includes('venda') ||
    clean.includes('entrou') ||
    clean.includes('reembolso');

  // Detecta forma de pagamento
  let paymentMethod = 'Não especificado';
  if (clean.includes('pix')) paymentMethod = 'Pix';
  else if (clean.includes('debito') || clean.includes('débito')) paymentMethod = 'Cartão de Débito';
  else if (clean.includes('credito') || clean.includes('crédito') || clean.includes('cartao') || clean.includes('cartão')) paymentMethod = 'Cartão de Crédito';
  else if (clean.includes('dinheiro') || clean.includes('especie') || clean.includes('espécie')) paymentMethod = 'Dinheiro';
  else if (clean.includes('boleto')) paymentMethod = 'Boleto';

  // Detecta categoria
  let category = isIncome ? 'Outros' : 'Alimentação';
  if (isIncome) {
    if (clean.includes('salario') || clean.includes('salário')) category = 'Salário';
    else if (clean.includes('deposito') || clean.includes('depósito')) category = 'Depósito';
    else if (clean.includes('rendimento') || clean.includes('dividendo')) category = 'Rendimentos';
    else if (clean.includes('venda') || clean.includes('vendi')) category = 'Vendas';
    else if (clean.includes('freela')) category = 'Freela';
    else if (clean.includes('reembolso')) category = 'Reembolso';
  } else {
    if (clean.includes('gasolina') || clean.includes('combustivel') || clean.includes('combustível') || clean.includes('uber') || clean.includes('onibus') || clean.includes('ônibus') || clean.includes('metro') || clean.includes('metrô')) category = 'Transporte';
    else if (clean.includes('agua') || clean.includes('água') || clean.includes('luz') || clean.includes('energia') || clean.includes('internet') || clean.includes('gas') || clean.includes('gás')) category = 'Contas/Boletos';
    else if (clean.includes('farmacia') || clean.includes('farmácia') || clean.includes('remedio') || clean.includes('remédio') || clean.includes('medico') || clean.includes('médico')) category = 'Saúde';
    else if (clean.includes('aluguel') || clean.includes('condominio') || clean.includes('condomínio')) category = 'Moradia';
    else if (clean.includes('cinema') || clean.includes('jogo') || clean.includes('viagem') || clean.includes('show') || clean.includes('netflix')) category = 'Lazer';
    else if (clean.includes('curso') || clean.includes('faculdade') || clean.includes('livro')) category = 'Educação';
  }

  // Descrição limpa
  let description = isIncome ? 'Receita' : 'Despesa';
  if (clean.includes('padaria')) description = 'Padaria';
  else if (clean.includes('mercado') || clean.includes('supermercado')) description = 'Mercado';
  else if (clean.includes('gasolina') || clean.includes('combustivel')) description = 'Combustível';
  else if (clean.includes('almoco') || clean.includes('almoço')) description = 'Almoço';
  else if (clean.includes('jantar') || clean.includes('lanche')) description = 'Lanche';
  else if (clean.includes('salario') || clean.includes('salário')) description = 'Salário';
  else if (clean.includes('deposito') || clean.includes('depósito')) description = 'Depósito';
  else if (clean.includes('farmacia') || clean.includes('farmácia')) description = 'Farmácia';
  else if (clean.includes('agua') || clean.includes('água')) description = 'Conta de Água';
  else if (clean.includes('luz')) description = 'Conta de Luz';
  else if (clean.includes('uber')) description = 'Uber';
  else {
    description = text.replace(/(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)/gi, '').replace(/(?:no|na|de|do|da|pix|credito|debito|cartao|dinheiro|boleto)\b/gi, '').trim();
    if (description.length < 2) description = isIncome ? 'Receita' : 'Despesa';
    description = description.charAt(0).toUpperCase() + description.slice(1);
  }

  return {
    is_financial_entry: true,
    type: isIncome ? 'INCOME' : 'EXPENSE',
    amount,
    category,
    payment_method: paymentMethod,
    description,
    date: new Date().toISOString(),
  };
}

/**
 * Processa texto informal e extrai o lançamento financeiro via Gemini AI com fallback inteligente
 */
export async function extractFinancialDataFromText(
  text: string
): Promise<FinancialExtractionResult> {
  const genAI = getGenAI();

  if (!genAI) {
    logger.warn('⚠️ GEMINI_API_KEY não configurada ou inválida. Usando extrator heurístico.');
    return fallbackExtract(text);
  }

  try {
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

    const parsed: FinancialExtractionResult = cleanAndParseJSON(responseText);
    return normalizeResult(parsed);
  } catch (error) {
    logger.error({ error, text }, 'Erro ao chamar Gemini AI. Usando extrator heurístico de contingência.');
    return fallbackExtract(text);
  }
}

/**
 * Processa áudio (Buffer de voz do WhatsApp) e extrai o lançamento financeiro
 */
export async function extractFinancialDataFromAudio(
  audioBuffer: Buffer,
  mimeType = 'audio/ogg; codecs=opus'
): Promise<FinancialExtractionResult> {
  const genAI = getGenAI();

  if (!genAI) {
    logger.error('GEMINI_API_KEY não configurada. Não é possível processar áudio sem a API do Gemini.');
    return { is_financial_entry: false };
  }

  try {
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

    const parsed: FinancialExtractionResult = cleanAndParseJSON(responseText);
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
