# Montagem de Coletores — guia de publicação

Aplicativo web para acompanhar a montagem de coletores compactadores na linha de produção.
Funciona em qualquer tablet, celular ou computador pelo navegador, e pode ser instalado na
tela inicial como se fosse um aplicativo comum.

Este guia assume que você **nunca publicou um site**. Siga na ordem. Leva cerca de 40 minutos.

---

## Antes de começar

Você vai criar três contas, todas gratuitas:

| Serviço | Para quê |
|---|---|
| Supabase | Guarda os dados (operadores, coletores, tarefas, marcações) |
| GitHub | Guarda o código |
| Vercel | Publica o site e gera o link |

Tenha um e-mail à mão. Recomendo usar o mesmo nos três.

---

## Parte 1 — Banco de dados no Supabase

### 1.1 Criar a conta e o projeto

1. Acesse **supabase.com** e clique em *Start your project*. Entre com o GitHub ou com e-mail.
2. Clique em **New project**.
3. Preencha:
   - **Name:** `montagem-coletores`
   - **Database Password:** clique em *Generate a password* e **guarde essa senha** num lugar seguro. Você provavelmente não vai precisar dela, mas se precisar e não tiver, não há como recuperar.
   - **Region:** `South America (São Paulo)` — é o mais próximo de Goiás, o app fica mais rápido.
4. Clique em **Create new project** e espere de 2 a 3 minutos.

### 1.2 Criar as tabelas

1. No menu da esquerda, clique em **SQL Editor**.
2. Clique em **New query**.
3. Abra o arquivo `supabase/schema.sql` deste projeto, copie **todo** o conteúdo e cole na caixa.
4. Clique em **Run** (ou `Ctrl+Enter`).
5. Deve aparecer *Success. No rows returned*. Se aparecer erro em vermelho, copie a mensagem — normalmente é o script tendo sido rodado duas vezes.

Para conferir: menu **Table Editor**. Você deve ver as tabelas `cargos`, `usuarios`, `modelos`,
`etapas`, `tarefas`, `caminhoes`, `registros_execucao` e `sessoes`. As tabelas `etapas` e
`tarefas` estão vazias de propósito — você vai montá-las pelo painel do aplicativo.

### 1.3 Criar o seu usuário de gestão

O login da gestão usa e-mail e senha de verdade. A matrícula `3454` com o chassi `0000` abre
a porta no tablet, mas a senha é o que protege os cadastros.

1. Menu **Authentication** → **Users** → botão **Add user** → *Create new user*.
2. Preencha seu e-mail e uma senha forte. Marque **Auto Confirm User**.
3. Clique em **Create user**.
4. Volte ao **SQL Editor**, nova query, e rode isto trocando pelo seu e-mail:

```sql
update usuarios
   set auth_user_id = (select id from auth.users where email = 'seu-email@exemplo.com')
 where matricula = '3454';
```

Deve responder *Success*. Se disser que 0 linhas foram afetadas, o e-mail está diferente do
que você cadastrou.

### 1.4 Copiar as chaves de conexão

1. Menu **Project Settings** (engrenagem) → **Data API**.
2. Anote dois valores — você vai colar os dois na Vercel daqui a pouco:
   - **Project URL** — algo como `https://abcdefgh.supabase.co`
   - **anon public** (em *Project API keys*) — um texto longo começando com `eyJ...`

A chave `anon` pode ficar visível no navegador sem problema: quem protege os dados são as
regras de RLS que o script já criou, não o sigilo dessa chave. A chave `service_role`, essa
sim, **nunca** deve sair do servidor — não use em lugar nenhum deste app.

---

## Parte 2 — Código no GitHub

### 2.1 Criar a conta e o repositório

1. Acesse **github.com** e crie sua conta.
2. Clique no **+** no canto superior direito → **New repository**.
3. **Repository name:** `montagem-coletores`. Marque **Private**. Clique em **Create repository**.

### 2.2 Subir os arquivos

O jeito mais simples, sem instalar nada:

1. Na página do repositório recém-criado, clique em **uploading an existing file**.
2. Descompacte o projeto no seu computador e arraste **todas as pastas e arquivos** para a
   janela do navegador (a pasta `src`, a pasta `public`, a pasta `supabase`, o `package.json`,
   o `index.html` e os demais).
3. Espere terminar o envio e clique em **Commit changes**.

> **Importante:** não envie o arquivo `.env` se você tiver criado um. Ele contém as chaves e
> não deve ir para o repositório. O `.gitignore` já impede isso quando se usa o Git pelo
> terminal, mas ao arrastar arquivos no navegador a responsabilidade é sua.

---

## Parte 3 — Publicar na Vercel

1. Acesse **vercel.com** e clique em **Sign up** → **Continue with GitHub**.
2. Autorize a Vercel a acessar sua conta do GitHub.
3. No painel, clique em **Add New** → **Project**.
4. Encontre `montagem-coletores` na lista e clique em **Import**.
5. A Vercel detecta o Vite sozinho. **Não mude** Framework, Build Command nem Output Directory.
6. Antes de publicar, abra **Environment Variables** e adicione as duas:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | a *Project URL* que você anotou |
   | `VITE_SUPABASE_ANON_KEY` | a chave *anon public* que você anotou |

   Cuidado ao colar: um espaço sobrando no fim da chave faz o app não conectar.
7. Clique em **Deploy** e espere de 1 a 2 minutos.

Ao terminar, a Vercel mostra o link, algo como
`https://montagem-coletores.vercel.app`. Esse é o endereço do seu aplicativo.

> Se a tela abrir dizendo *"Falta configurar o banco"*, as variáveis de ambiente não foram
> lidas. Vá em **Settings → Environment Variables**, confira os nomes (precisam começar com
> `VITE_`), e depois em **Deployments** clique nos três pontos do último deploy →
> **Redeploy**. Variável nova só vale depois de republicar.

### Trocar o endereço

Em **Settings → Domains** você pode mudar o subdomínio para algo como
`montagem-cimasp.vercel.app`, ou apontar um domínio próprio da empresa.

---

## Parte 4 — Instalar no tablet

O aplicativo é um PWA: abre pelo navegador, mas pode virar ícone na tela inicial e abrir em
tela cheia, sem barra de endereço.

### Android (Chrome)

1. Abra o link no Chrome.
2. Toque nos **três pontos** no canto superior direito.
3. Toque em **Instalar aplicativo** (ou *Adicionar à tela inicial*).
4. Confirme. O ícone verde aparece junto dos outros aplicativos.

### iPad / iPhone (Safari)

1. Abra o link no **Safari** — precisa ser o Safari, não funciona pelo Chrome no iOS.
2. Toque no botão **Compartilhar** (quadrado com seta para cima).
3. Role e toque em **Adicionar à Tela de Início**.
4. Toque em **Adicionar**.

### Computador (Chrome ou Edge)

Na barra de endereço aparece um ícone de instalação à direita. Clique e confirme.

---

## Parte 5 — Primeira configuração da linha

Com o app publicado, entre como gestão e monte a linha. A ordem importa:

1. **Entre:** matrícula `3454`, chassi `0000`, depois seu e-mail e senha.
2. **Aba Cargos:** confira os cargos que vieram prontos (Soldador, Eletricista, Montador
   Mecânico, Pintor, Hidráulico) e acrescente os que a sua fábrica tem.
3. **Aba Linha de montagem:** crie as etapas na ordem real da produção. Dentro de cada etapa,
   crie as tarefas e defina o cargo responsável por cada uma.
4. **Aba Modelos:** confira os modelos de coletor e corrija as fotos se precisar.
5. **Aba Coletores:** cadastre os chassis que estão em produção e aponte a etapa de cada um.
6. **Aba Operadores:** cadastre a equipe com matrícula e cargo.

Só depois disso o operador consegue trabalhar. Se ele entrar antes, vê a mensagem
*"Checklist ainda não configurado"* em vez de uma tela quebrada.

---

## Como usar no dia a dia

**Operador:** digita a matrícula, toca no coletor em que vai trabalhar e entra. Vê todas as
tarefas da etapa, mas só consegue marcar as do próprio cargo — as outras aparecem
desabilitadas com o aviso de qual cargo é responsável. Cada tarefa vai de *Iniciar* para
*OK*, e dá para desfazer.

**Modo lote:** se o wifi do galpão for ruim, o operador muda para *Acumular lote* e envia
tudo de uma vez no fim do turno. As marcações ficam guardadas no próprio tablet e sobem
sozinhas quando a rede volta.

**Gestão:** na aba Operadores, o botão *Ver perfil* mostra em qual coletor e em qual etapa
cada pessoa está agora, além do histórico de marcações.

---

## Coisas que você precisa saber

**O histórico não é editável.** A tabela de registros é append-only: um gatilho no banco
recusa qualquer tentativa de alterar ou apagar uma marcação. Desfazer uma tarefa grava um
novo registro do tipo *reabertura*, preservando o que aconteceu antes. É isso que permite o
sistema servir de prova meses depois, num recall ou numa discussão de garantia.

**A regra de cargo é cumprida pelo banco, não pelo navegador.** O operador não tem permissão
de escrever direto na tabela de registros — toda marcação passa por uma função do Postgres
que confere o cargo antes de gravar. Mesmo que alguém abra as ferramentas de desenvolvedor no
tablet, não consegue marcar tarefa de outro cargo.

**Matrícula identifica, não autentica.** Qualquer pessoa que saiba a matrícula do colega pode
marcar no nome dele. Para o chão de fábrica isso costuma ser aceitável, mas se não for, o
banco já tem o campo `pin_hash` preparado: basta passar a exigir um PIN de quatro dígitos por
operador.

**A presença expira sozinha em 45 minutos.** Ninguém desloga ao sair para o almoço. Sem essa
expiração, o painel mostraria meia fábrica "na linha" às três da manhã.

**As fotos dos coletores são links externos.** Se o site de origem mudar os arquivos de lugar,
a foto some e aparece o nome do modelo no lugar. Para não depender disso, suba as imagens no
Storage do Supabase e troque as URLs na aba Modelos.

---

## Rodar na sua máquina (opcional)

Se quiser testar localmente antes de publicar, precisa do Node.js instalado:

```bash
npm install
cp .env.example .env     # preencha com suas chaves do Supabase
npm run dev
```

Abre em `http://localhost:5173`.

Atenção: o service worker e a instalação como aplicativo só funcionam em HTTPS ou em
`localhost`. Em produção a Vercel já entrega HTTPS por padrão.

---

## Próximos passos sugeridos

1. **PIN por operador**, se a identificação simples não bastar.
2. **Avanço automático de etapa** quando todas as tarefas obrigatórias forem concluídas.
3. **Relatórios**: tempo médio por etapa, produtividade por cargo, gargalos da linha.
4. **Fotos e assinatura** na conclusão de etapas críticas, para valor documental.
5. **Backup**: o plano gratuito do Supabase pausa projetos inativos e tem retenção limitada.
   Antes de depender disso para valer, avalie o plano pago ou configure exportação periódica.
