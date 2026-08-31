# 💰 Bot de Controle Financeiro via WhatsApp (Baileys + Gemini AI + PostgreSQL)

Aplicação monolítica em **Node.js/TypeScript** para controle financeiro pessoal integrado diretamente ao WhatsApp via **Baileys (cliente nativo embutido)**, utilizando um **Grupo Privado** como interface de chat e o **Google Gemini AI** para interpretação inteligente de mensagens de texto e notas de voz.

---

## 🚀 Principais Funcionalidades

1. **WhatsApp Embutido (Baileys):** Não necessita de instâncias externas de Evolution API ou Z-API.
2. **Painel Web com QR Code em Tempo Real:** Rota `GET /?token=SEU_TOKEN` com interface moderna em TailwindCSS e atualização ao vivo (via Server-Sent Events).
3. **Persistência de Sessão no PostgreSQL:** As credenciais e chaves criptográficas (`WhatsAppSession`) são salvas diretamente no banco, evitando desconexões após reinicializações/deploys no Render.
4. **Inteligência Artificial (Google Gemini):** Extrai valor, categoria, tipo (Receita/Despesa), forma de pagamento e descrição tanto de **textos informais** quanto de **áudios/notas de voz**.
5. **Filtro Estrito de Grupo:** O bot ignora DMs, status e outros grupos, respondendo exclusivamente no grupo configurado (`TARGET_GROUP_JID`).
6. **Comandos Rápidos no Chat:**
   * `/saldo` ou `/resumo`: Exibe o total de receitas, despesas e o saldo líquido do mês.
   * `/extrato`: Lista as últimas 5 transações com seus IDs para referência.
   * `/deletar <ID>`: Exclui/cancela uma transação existente.
   * `/ajuda`: Exibe o guia rápido de comandos.

---

## 🛠️ Stack Tecnológica

* **Runtime:** Node.js 20+ / TypeScript
* **Servidor HTTP:** Express.js + Server-Sent Events (SSE)
* **Engine WhatsApp:** `@whiskeysockets/baileys`
* **Inteligência Artificial:** `@google/generative-ai` (Gemini 1.5 Flash)
* **Banco de Dados & ORM:** PostgreSQL + Prisma ORM
* **Testes:** Vitest

---

## 📋 Variáveis de Ambiente (`.env`)

Crie um arquivo `.env` na raiz do projeto com as seguintes variáveis:

```env
PORT=3000
NODE_ENV=production

# URL de conexão do PostgreSQL (Local ou Render Managed PostgreSQL)
DATABASE_URL=postgresql://usuario:senha@host:5432/nome_banco?sslmode=require

# Chave de API do Google Gemini (obtenha em https://aistudio.google.com/)
GEMINI_API_KEY=AIzaSy...

# JID do Grupo Privado do WhatsApp (Ex: 120363000000000000@g.us)
TARGET_GROUP_JID=120363000000000000@g.us

# Senha secreta para visualizar o QR Code na Web
ADMIN_WEB_TOKEN=sua_senha_secreta_aqui
```

> **Dica para obter o `TARGET_GROUP_JID`:**
> Crie um grupo no WhatsApp com o seu bot. Ao enviar qualquer mensagem no grupo após conectar o bot, o JID do grupo (no formato `120363xxxxxxxxx@g.us`) aparecerá nos logs do terminal.

---

## 💻 Como Rodar Localmente

### 1. Instalar Dependências
```bash
npm install
```

### 2. Configurar o Banco de Dados
Gere os clientes do Prisma e execute as migrations:
```bash
npm run prisma:generate
npm run prisma:migrate
```

### 3. Iniciar em Modo de Desenvolvimento
```bash
npm run dev
```

### 4. Conectar o WhatsApp
Abra o navegador no endereço:
```text
http://localhost:3000/?token=sua_senha_secreta_aqui
```
Abra o WhatsApp no celular > **Aparelhos Conectados** > **Conectar um aparelho** e escaneie o QR Code exibido na tela.

---

## 🌐 Deploy no Render

1. Crie um novo **PostgreSQL Database** no Render e copie a `Internal Database URL` ou `External Database URL`.
2. Crie um novo **Web Service** conectado ao seu repositório no Render.
3. Configure as propriedades do Web Service:
   * **Environment:** `Node`
   * **Build Command:** `npm run build` (que executa `prisma generate && tsc`)
   * **Start Command:** `npm start` (que executa `prisma migrate deploy && node dist/server.js`)
4. Nas **Environment Variables** do Render, adicione:
   * `DATABASE_URL` = *(URL do seu PostgreSQL)*
   * `GEMINI_API_KEY` = *(Sua chave do Gemini)*
   * `TARGET_GROUP_JID` = *(JID do grupo)*
   * `ADMIN_WEB_TOKEN` = *(Token de acesso ao QR Code)*
   * `NODE_ENV` = `production`
5. Acesse a URL do Render com `?token=SEU_TOKEN` para autenticar o QR Code!

---

## 🧪 Testes Automatizados

Para rodar a suíte de testes:
```bash
npm test
```
