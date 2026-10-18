---
description: "Sugestões de respostas rápidas contextuais com atalhos de teclado para o DeepSeek Harness (DSH): exibe de 0 a 3 opções dinâmicas logo acima do composer assim que o assistente conclui sua resposta."
kind: "package-reference"
---

# dsh-quick-replies

[English](README.md) | Português

Sugestões contextuais de respostas rápidas e acionamento por teclado para o [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness).

## Sumário

O `dsh-quick-replies` acelera o fluxo de trabalho e reduz a fadiga cognitiva em sessões com o DSH. Imediatamente após o encerramento do turno do assistente, um sumarizador leve em segundo plano analisa o contexto recente e deriva de **0 a 3 sugestões acionáveis**, exibidas diretamente acima do campo de mensagem no slot `conversation.input.dock`.

As sugestões podem ser clicadas ou disparadas instantaneamente por atalhos de teclado dedicados (`⌥1`, `⌥2`, `⌥3` no macOS / `Alt+1`, `Alt+2`, `Alt+3` no Linux e Windows). Se uma resposta não exigir continuidade ou se a tarefa estiver concluída, o componente se recolhe por completo sem poluir a interface visual.

## Índice

- [Como Usar](#como-usar)
  - [Instalação](#instalacao)
  - [Atalhos de teclado](#atalhos-de-teclado)
  - [Foco do composer e proteção de digitação](#foco-do-composer-e-protecao-de-digitacao)
- [Entenda a Implementação](#entenda-a-implementacao)
  - [Lado Host (`index.js`)](#lado-host-indexjs)
  - [Lado Client (`client.js`)](#lado-client-clientjs)
  - [Concorrência e cancelamento](#concorrencia-e-cancelamento)
- [Experiência de Modelo](#experiencia-de-modelo)
  - [Contrato de prompt do sumarizador](#contrato-de-prompt-do-sumarizador)
  - [Impacto em KV Cache e tokens](#impacto-em-kv-cache-e-tokens)
- [Configuração](#configuracao)
- [Limitações Conhecidas](#limitacoes-conhecidas)
- [Desenvolvimento e Testes](#desenvolvimento-e-testes)
- [Licença](#licenca)

-----

<a id="como-usar"></a>
## Como Usar

Ao ativar o bundle em seu perfil do DSH, o plugin monitora o ciclo de vida das mensagens. Quando o assistente finaliza sua resposta, o sumarizador em segundo plano determina as opções pertinentes e renderiza os chips interativos logo acima da barra de digitação.

<a id="instalacao"></a>
### Instalação

Como o pacote é distribuído diretamente via repositório, instale-o em seu perfil ativo do DSH via CLI apontando para o GitHub:

```bash
dsh plugin install github:medeiroshudson/dsh-quick-replies
```

Ou declare-o como dependência do GitHub no `package.json` do seu perfil e monte o registro no `cordis.patch.yml`:

**`package.json`:**
```json
{
  "dependencies": {
    "dsh-quick-replies": "github:medeiroshudson/dsh-quick-replies"
  }
}
```

**`cordis.patch.yml`:**
```yaml
- insert:
    - id: dsh-quick-replies
      name: 'dsh-quick-replies'
      config: {}
```

<a id="atalhos-de-teclado"></a>
### Atalhos de teclado

Os chips de resposta rápida são mapeados para teclas numéricas com o modificador primário:

| Atalho (macOS) | Atalho (Linux / Windows) | Ação |
|---|---|---|
| `⌥1` | `Alt+1` | Envia imediatamente a sugestão 1 |
| `⌥2` | `Alt+2` | Envia imediatamente a sugestão 2 |
| `⌥3` | `Alt+3` | Envia imediatamente a sugestão 3 |

<a id="foco-do-composer-e-protecao-de-digitacao"></a>
### Foco do composer e proteção de digitação

Para garantir que os atalhos nunca atrapalhem a digitação manual de mensagens:
1. **Campo vazio:** Se você não tiver digitado nada no campo de texto, `⌥1..3` intercepta a tecla, despacha a sugestão escolhida imediatamente e limpa a barra.
2. **Digitação em andamento:** Se você já começou a digitar uma mensagem manual, `⌥1..3` é ignorado pelo manipulador de atalhos e passa normalmente para a composição nativa de caracteres do teclado (evitando conflito com símbolos do macOS/Linux).
3. **Limites dinâmicos:** Se houver apenas 2 sugestões disponíveis, `⌥3` fica inativo.

-----

<a id="entenda-a-implementacao"></a>
## Entenda a Implementação

<details>
<summary>Detalhes internos da arquitetura — clique para expandir</summary>

O pacote é composto por duas metades integradas via Cordis:

### Lado Host (`index.js`)
- **Monitoramento de status:** Ouve o evento `agent/status`. Quando o status passa de `running` para `idle`, inspeciona o histórico recente da sessão através do `sessionController` para extrair o último prompt do usuário e a resposta final do modelo.
- **Sanitização de contexto:** Turnos com uso intensivo de ferramentas (bash, leituras de arquivo, etc.) são resumidos em indicadores leves (ex: `[Executed tools: bash, edit]`), evitando explosão de contexto e garantindo respostas rápidas.
- **Chamada de modelo ultraleve:** Dispara uma chamada de streaming com `maxTokens: 60`, `temperature: 0.3` e raciocínio/thinking suprimido, reutilizando a conexão e credenciais ativas da sessão.
- **Cache por sessão:** Armazena as sugestões geradas em memória indexadas por `sessionId`, mantendo as opções salvas mesmo ao alternar entre abas ou workspaces.

### Lado Client (`client.js`)
- **Injeção de slot:** Carregado pelo `window.__ModuleLoader__`, injeta o componente React no slot `conversation.input.dock` com `order: 5`.
- **Design System do DSH:** Utiliza exclusivamente as variáveis nativas de tema do DSH (`--dsw-alias-bg-layer-1`, `--dsw-alias-bg-layer-2`, `--dsw-alias-border-l1`, `--dsw-alias-brand-primary`, etc.), adaptando-se perfeitamente aos modos claro e escuro.
- **Envio imediato:** Envia o prompt selecionado via `ctx.remote.session.prompt` com `{ mode: 'queue', content: [{ type: 'text', text: suggestion }] }`.
- **Extração local de contingência:** Caso a conexão RPC esteja indisponível, o cliente possui um parser local que detecta opções numeradas ou itens com marcadores diretamente do texto renderizado do assistente.

### Concorrência e cancelamento
O Host mantém um `AbortController` para cada sessão. Se você começar a digitar e enviar uma mensagem enquanto o sumarizador ainda estiver gerando sugestões em segundo plano, a chamada em andamento é cancelada imediatamente, evitando sugestões atrasadas e efeitos visuais fantasmas.

</details>

-----

<a id="experiencia-de-modelo"></a>
## Experiência de Modelo

<a id="contrato-de-prompt-do-sumarizador"></a>
### Contrato de prompt do sumarizador

O prompt de sistema do sumarizador impõe uma extração estrita em JSON:

```text
You are an intent predictor for an interactive AI assistant.
Analyze the assistant's last message and immediate user context.
Determine if 0, 1, 2, or 3 quick next-step responses or decisions make sense for the user to reply with.
If the response is a concluding statement, requires no action, or has no sensible next prompts, return an empty array [].

Return strictly valid JSON matching this schema:
{
  "suggestions": [
    "Short actionable prompt 1",
    "Short actionable prompt 2"
  ]
}
```

<a id="impacto-em-kv-cache-e-tokens"></a>
### Impacto em KV Cache e tokens

- **Tokens de entrada:** ~80 a 180 tokens (prompt recente + resposta truncada + instruções concisas).
- **Tokens de saída:** Teto limitado a 60 tokens (`maxTokens: 60`).
- **Esforço de raciocínio:** Desativado para respostas em fração de segundo sem consumir cotas de reasoning.
- **Impacto no histórico do agente:** Zero. A chamada ocorre fora do loop do agente e não é gravada no log durável da sessão.

-----

<a id="configuracao"></a>
## Configuração

O bundle aceita os seguintes parâmetros em `cordis.patch.yml` ou nas configurações do perfil:

| Opção | Tipo | Padrão | Descrição |
|---|---|---|---|
| `maxSuggestions` | `number` | `3` | Número máximo de sugestões renderizadas (1 a 3). |
| `maxTokens` | `number` | `60` | Teto máximo de tokens na resposta do sumarizador. |
| `temperature` | `number` | `0.3` | Temperatura do modelo para a geração de sugestões. |

-----

<a id="limitacoes-conhecidas"></a>
## Limitações Conhecidas

- **Turnos em streaming:** As respostas sugeridas são geradas somente após a resposta se assentar por completo (`agent/status` idle); não há streaming parcial enquanto chamadas de ferramentas ainda estão em execução.
- **Entradas puramente de texto:** Os prompts de sugestão são exclusivamente de texto, não gerando anexos de arquivo ou imagens automáticos.

-----

<a id="desenvolvimento-e-testes"></a>
## Desenvolvimento e Testes

O repositório utiliza ECMAScript Modules nativos e o test runner embutido do Node.js:

```bash
# Executa todos os testes unitários
npm test

# Executa testes em modo de observação contínua
node --test --watch tests/*.test.js

# Verificação de sintaxe de todos os arquivos
node -c index.js client.js src/*.js
```

### Destaques da Cobertura de Testes
- `tests/summarizer.test.js`: Extração de JSON resiliente, suporte a blocos markdown, teto de 3 opções, truncamento em 50 caracteres e sanitização de ferramentas.
- `tests/host-service.test.js`: Isolamento de cache por sessão, cancelamento com `AbortController` ao iniciar novo turno e recuperação elegante de erros de rede.
- `tests/client-component.test.js`: Mapeamento de teclas, detecção de foco no campo, guarda de texto digitado e validação de limites de opções.

-----

<a id="licenca"></a>
## Licença

MIT © Hudson Medeiros
