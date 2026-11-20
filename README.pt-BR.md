# Sync_Relay by Sync_Labs

[English](README.md)

O Sync_Relay é um plugin para o Claude Code e o Codex. Ele faz três coisas:

1. Impede que a sessão principal interativa faça trabalho com ferramenta. Leitura, busca, comando de shell, escrita, web e MCP vão para um subagente, escolhido numa tabela de delegação que você edita. Subagentes e automação (`claude -p`, `codex exec`) nunca são bloqueados.
2. Passa a sessão adiante. Digite `handoff` (ou `passagem`): o modelo grava o estado do trabalho num arquivo, e a próxima sessão no mesmo diretório, em qualquer um dos dois CLIs, já começa com ele.
3. Avisa quando o contexto passou de um limite, para você saber que é hora de trocar.

Tudo roda na sua máquina. O plugin não faz nenhuma chamada de rede. Licença: MIT.

O repositório tem dois plugins:

| Plugin | CLI | O que é |
|---|---|---|
| `synclabs-relay` | Claude Code, Codex | O núcleo: ganchos, tabela de delegação, passagem, aviso de contexto. |
| `synclabs-relay-band` | só Claude Code | Opcional. Um botão e o comando `/handoff` que disparam a troca por você. Precisa do núcleo. |

## Requisitos

- Python 3.9 ou mais novo, acessível como `python3` no PATH. Os ganchos chamam `python3` e mais nada.
- Claude Code 2.1.323 ou mais novo. Testado na 2.1.328 e na 2.1.329.
- Codex CLI 0.170.0: o plugin instala e o gancho foi conferido sem modelo. Não foi testado numa sessão real do Codex (veja Instalação, Codex).
- Os testes rodaram no Windows. macOS e Linux não foram testados.

No Windows, o Claude Code roda os ganchos pelo Git Bash. Instaladores antigos do python.org não criam `python3`; sem ele, os ganchos falham em todo evento com um erro que não bloqueia, e o plugin fica inativo. O atalho da Microsoft Store responde por `python3`. Os ganchos falham abertos: sem Python, o CLI continua funcionando.

## Instalação

Claude Code:

```
claude plugin marketplace add Sync-Labs-team/Sync_Relay
claude plugin install synclabs-relay@synclabs-relay
```

Também funciona em um passo: `claude plugin install synclabs-relay --marketplace Sync-Labs-team/Sync_Relay`.

Para a faixa opcional (só Claude Code):

```
claude plugin install synclabs-relay-band@synclabs-relay
```

A faixa declara o núcleo como dependência, e o Claude Code não deixa desativar o núcleo enquanto a faixa estiver instalada. A faixa usa a API de mods do Claude Code, que está em acesso antecipado e pode mudar.

Codex:

> O suporte ao Codex não foi testado na v0.1.0. O plugin foi instalado no Codex e o gancho foi rodado direto, sem modelo, e negou uma ferramenta como esperado. Não foi testado numa sessão real do Codex: a trava, o aviso de contexto e a passagem ainda não foram vistos funcionando lá. Os testes estão previstos para a próxima versão.

```
codex plugin marketplace add Sync-Labs-team/Sync_Relay
codex plugin add synclabs-relay@synclabs-relay
codex plugin list
```

O `codex plugin list` deve mostrar `synclabs-relay@synclabs-relay` como `installed, enabled`.

Para instalar de um clone local, passe a pasta no lugar de `Sync-Labs-team/Sync_Relay` nos comandos `marketplace add`. A forma em um passo com `--marketplace` também aceita pasta.

### Aprovar os ganchos no Codex

O Codex ignora o gancho de um plugin até você confiar nele. Abra a TUI do Codex, rode `/hooks` e aprove os ganchos do Sync_Relay. Enquanto isso não acontece, nada acontece, e no `codex exec` os ganchos são pulados sem mensagem, então o silêncio indica gancho não aprovado. Toda vez que a definição do gancho muda, o Codex pede de novo. Por isso os arquivos de gancho deste plugin ficam fixos e a lógica mora no script.

O Claude Code não tem etapa de aprovação.

## Como funciona

### A trava

No `PreToolUse`, a sessão principal interativa tem negada qualquer ferramenta que não esteja na lista livre. A lista livre tem as ferramentas de orquestração: `Agent`, `SendMessage`, `AskUserQuestion`, `ToolSearch`, `Skill`, as de tarefas, o modo de plano e, no Codex, `spawn_agent`, `wait`, `send_input`, `update_plan` e parecidas. Some outras com `allowed_tools`.

O que conta como sessão principal interativa:

- Claude Code: o processo não foi iniciado por `claude -p` nem pelo SDK (`CLAUDE_CODE_ENTRYPOINT` não começa com `sdk`), e a chamada não traz `agent_id`.
- Codex: o cabeçalho do rollout tem um originador interativo (`codex-tui` e `codex_work_desktop` por padrão; mude com `codex_interactive_originators`) e a sessão não é subagente.

Se o plugin não consegue saber, não bloqueia. Mostra uma mensagem por sessão e segue (falha aberta).

O texto da negação diz como desligar a trava.

### A tabela de delegação

Quando uma sessão principal começa, retoma, limpa ou compacta, o plugin injeta uma tabela de cinco camadas, montada a partir da configuração: consulta, julgamento técnico, implementação, depuração difícil, plano. Cada camada traz tipo de agente, modelo e esforço por CLI. Com `"model": null`, nenhum modelo é passado e o subagente herda o da sessão. Padrões:

| Camada | Claude Code | Codex |
|---|---|---|
| `lookup` | `Explore`, haiku, low | `explorer`, low |
| `judgment` | `general-purpose`, sonnet, medium | `explorer`, medium |
| `build` | `general-purpose`, sonnet, medium | `worker`, medium |
| `hard` | `general-purpose`, opus, high | `worker`, high |
| `plan` | `general-purpose`, opus, xhigh | `worker`, high |

A tabela também pede aos subagentes um relatório curto. Quando o relatório final de um subagente passa de `report_max_chars` (4000), o gancho `SubagentStop` devolve uma vez e pede um relatório menor. Com `report_max_chars` em `0`, os dois pedidos somem. Um lembrete curto acompanha cada mensagem que você envia.

### Passagem

1. Digite `handoff` ou `passagem` (com ou sem `/` na frente) no prompt.
2. O gancho manda o modelo esperar até não haver agente rodando e então gravar o estado num arquivo Markdown de até 8.000 caracteres, no seu idioma: seu pedido, estado, decisões, onde está cada coisa, próximos passos numerados, riscos. No Claude Code o modelo grava sozinho, e o núcleo pré-aprova esse único `Write` (veja Permissão da gravação da passagem, abaixo). No Codex ele delega a gravação a um subagente que herda o contexto.
3. O modelo responde `passagem pronta` (em inglês, `handoff ready`). Abra a sessão nova: `/clear` no Claude Code, `/new` no Codex.
4. O gancho `SessionStart` da sessão nova coloca o arquivo no contexto dela.

O núcleo é a única parte que entrega a passagem, nos dois CLIs. Qual arquivo cada sessão pega:

- Claude Code depois do `/clear`: o arquivo nomeado no marcador `_req-<PID>.txt` desse mesmo processo (`<PID>` é o `CLAUDE_PID`); se não houver, o que o Codex gravou para o mesmo diretório. O marcador guarda um nome de arquivo, `<slug do diretório>-<8hex>.md`. Marcador vazio quer dizer troca cancelada (a faixa o grava quando você aperta Cancelar). Com marcador vazio ou nome inválido, nada é entregue por PID e o plano B abaixo não roda.
- Claude Code depois do `/clear`, sem `CLAUDE_PID`: o único `<slug>-<8hex>.md` do diretório com menos de 30 minutos. Com dois ou mais, não entrega.
- Janela nova do Claude Code: só uma passagem do Codex para o mesmo diretório.
- Codex: a passagem mais nova do mesmo diretório, inclusive as gravadas pelo Claude Code (veja Limites conhecidos).
- Passagem com mais de 30 minutos é ignorada. Cada arquivo é pego uma vez. Se der erro depois que uma sessão pegou o arquivo e antes de o texto ser impresso, o arquivo é renomeado de volta, então não se perde.
- Texto acima de 9.000 caracteres é cortado, com um aviso e o caminho do arquivo. O Claude Code transforma contexto de gancho acima de 10.000 caracteres em caminho e uma prévia curta, então o contexto inteiro fica abaixo de 9.000 caracteres. A passagem entra primeiro e nunca é cortada por causa de outra coisa. A tabela de roteamento fica com o que sobrar: se não couber, é cortada e termina com uma linha de aviso, e se não houver espaço nem para o aviso, fica de fora.

Onde ficam os arquivos, por padrão:

- Windows: `%LOCALAPPDATA%\synclabs-relay\handoffs`
- macOS e Linux: `$XDG_STATE_HOME/synclabs-relay/handoffs` ou `~/.local/state/synclabs-relay/handoffs`

O nome do arquivo é `<parte legível>-<h8>`, mais `-<8 primeiros caracteres do id da sessão>` no Claude Code. A parte legível é o diretório de trabalho em minúsculas, com cada trecho de outros caracteres trocado por `-`, os últimos 60 caracteres. `h8` é o hash FNV-1a de 32 bits (8 dígitos hexadecimais minúsculos) dos bytes UTF-8 do diretório, então `my_app`, `my-app` e `My App` ficam com arquivos diferentes. No Windows o diretório vai para minúsculas, `/` vira `\` e a barra final sai antes do hash. Exemplo: `/home/alice/app` vira `home-alice-app-a172203a.md` no Codex.

### Permissão da gravação da passagem

No Claude Code, o núcleo pré-aprova (`permissionDecision: "allow"`) uma única chamada de ferramenta: o `Write` do arquivo da própria passagem da sessão. Todas estas condições têm de valer:

- sessão principal, não subagente;
- um `CLAUDE_PID` válido e um marcador `_req-<PID>.txt` com no máximo 10 minutos;
- o caminho é igual a `<pasta>/<nome que está no marcador>`, sem `..` e sem fluxo alternativo do NTFS (`:`);
- a pasta de passagens é segura e o alvo não é um link;
- o conteúdo tem no máximo 8.000 caracteres.

Vale em qualquer modo, inclusive `off`. Suas regras `deny` e `ask` continuam valendo: a documentação do Claude Code diz "Deny and ask rules are still evaluated regardless of what the hook returns". Em qualquer outra gravação, decide o fluxo normal de permissão. Se faltar o `CLAUDE_PID`, ou se o diretório de trabalho mudar antes do `Write`, o Claude Code pode pedir sua confirmação.

### Aviso de contexto

No fim de um turno (`Stop`), se o contexto cresceu `threshold_tokens` (150.000 por padrão) além de onde a sessão começou, uma mensagem diz para digitar `handoff`. A conta é o crescimento desde o começo da própria sessão, não o tamanho absoluto. No Claude Code o plugin soma os tokens de entrada, de criação de cache e de leitura de cache da última resposta da sessão principal. No Codex usa a última contagem de tokens do rollout. Se a faixa estiver instalada, ponha `stop_warning` em `false` no Claude Code, porque a faixa mostra o próprio aviso.

As medições por trás dos 150.000 estão na próxima seção.

## Configuração

Um arquivo para os dois CLIs. O plugin procura nesta ordem, vale o primeiro que existir:

1. o caminho em `SYNCLABS_RELAY_CONFIG`
2. `$XDG_CONFIG_HOME/synclabs-relay/config.json`
3. Windows: `%APPDATA%\synclabs-relay\config.json`
4. `~/.config/synclabs-relay/config.json`

Arquivo ausente, JSON inválido, tipo errado ou chave desconhecida são ignorados e vale o padrão, sem erro. BOM UTF-8 não atrapalha. Seus valores sobrescrevem os padrões chave a chave; dentro de `routing`, camada a camada e CLI a CLI.

| Chave | Padrão | O que faz |
|---|---|---|
| `mode` | `"enforce"` | `enforce` nega ferramenta de trabalho na sessão principal. `remind` só lembra. `off` desliga a trava e os lembretes; a passagem continua funcionando. |
| `lang` | `"auto"` | `auto`, `en` ou `pt-BR`. Maiúscula não importa: `pt`, `pt-BR`, `pt_BR` e `pt-*` valem pt-BR; `en`, `en-*` e `en_*` valem inglês. `SYNCLABS_RELAY_LANG` só vale quando é um destes; qualquer outro valor passa para a fonte seguinte. O `auto` lê `LC_ALL`, `LC_MESSAGES`, `LANG` e depois o idioma do sistema (a faixa lê só o idioma do sistema): `pt` é pt-BR, o resto é inglês. |
| `threshold_tokens` | `150000` | Crescimento sobre o começo da sessão que dispara o aviso. Tem de ser maior que 0. A faixa aceita de 5.000 a 900.000. |
| `stop_warning` | `true` | O aviso do `Stop` no Claude Code. |
| `report_max_chars` | `4000` | Maior relatório de subagente; `0` desliga o limite. |
| `handoff_dir` | `""` | Pasta absoluta das passagens. Vazio usa o padrão acima. `~` no início vale a sua pasta de usuário. O Windows pede unidade (`C:\` ou `C:/`) ou caminho de rede (`\\servidor\pasta`); o macOS e o Linux pedem `/` no início. Caminho relativo, caminho com segmento `..` ou pasta que o plugin não consegue usar cai no padrão. O núcleo e a faixa aplicam a mesma regra. No macOS e no Linux, o plugin não muda a permissão de uma pasta que você configura; protegê-la é com você. |
| `allowed_tools` | `[]` | Ferramentas extras que a sessão principal pode usar, como `"mcp__servidor__ferramenta"`. Somam-se à lista embutida. |
| `codex_interactive_originators` | `["codex-tui", "codex_work_desktop"]` | Originadores do Codex tratados como interativos. |
| `routing` | tabela acima | `routing.<camada>.<claude ou codex>` com `agent`, `model`, `effort`. |

Variáveis de ambiente, que valem mais que o arquivo:

| Variável | Valores |
|---|---|
| `SYNCLABS_RELAY_MODE` | `off`, `remind`, `enforce`, `force`. O `force` trata toda sessão como interativa. Serve para teste. |
| `SYNCLABS_RELAY_LANG` | `auto`, `en`, `pt-BR` |
| `SYNCLABS_RELAY_CONFIG` | caminho de outro arquivo de configuração |

Exemplo, com um usuário fictício:

```json
{
  "lang": "pt-BR",
  "threshold_tokens": 120000,
  "stop_warning": false,
  "allowed_tools": ["mcp__notas__buscar"],
  "routing": {
    "build": {
      "claude": { "agent": "general-purpose", "model": "haiku", "effort": "medium" },
      "codex": { "agent": "worker", "model": "id-do-meu-modelo", "effort": "medium" }
    }
  }
}
```

Salvo em `C:\Users\alice\AppData\Roaming\synclabs-relay\config.json` no Windows ou em `~/.config/synclabs-relay/config.json` nos outros sistemas. Os ids de modelo do lado do Codex são seus; o plugin não traz nenhum.

### A faixa

Instale o `synclabs-relay-band` e, quando o limite é atingido, aparece uma faixa com o botão Trocar de sessão. A troca espera a sessão principal ficar livre e nenhum agente estar rodando, pede a passagem e então roda `/clear`. A sessão nova recebe a passagem do núcleo. Ao terminar, a faixa mostra "Passagem gravada; sessão nova aberta." Ela não afirma que a passagem foi entregue: quem entrega é o núcleo, e só se os arquivos baterem (veja Passagem). Cancelar retira o pedido: a faixa esvazia o marcador, então nada é entregue por PID.

- `/handoff`: troca agora.
- `/handoff auto`: liga ou desliga o modo automático. Desligado por padrão. Ligado, troca sozinho depois de uma contagem de 15 s que você pode cancelar.
- `/handoff botao` (ou `button`): esconde ou mostra o botão acima do campo.
- `/handoff limiar [Nk|padrao]` (ou `threshold [Nk|default]`): mostra ou muda o limite.

A faixa lê `threshold_tokens`, `lang` e `handoff_dir` do mesmo arquivo. Para uma sessão, `SYNCLABS_RELAY_BAND_THRESHOLD` e `SYNCLABS_RELAY_BAND_AUTO` (`1` ou `0`) sobrescrevem esses valores.

## Como desligar

- Uma sessão: abra o CLI com `SYNCLABS_RELAY_MODE=off`.
- Em definitivo: ponha `"mode": "off"` (ou `"remind"`) no arquivo de configuração.
- Claude Code: `claude plugin disable synclabs-relay@synclabs-relay`; para remover, `claude plugin uninstall synclabs-relay@synclabs-relay`.
- Codex: `codex plugin remove synclabs-relay@synclabs-relay`.
- Com a faixa instalada, desligue ou remova a faixa primeiro (`claude plugin disable synclabs-relay-band@synclabs-relay` ou `claude plugin uninstall synclabs-relay-band@synclabs-relay`) e depois o núcleo. Senão o comando do núcleo falha com "still required by synclabs-relay-band".

Se uma versão do Claude Code parar de enviar `agent_id` aos subagentes, todo subagente seria negado. Use `SYNCLABS_RELAY_MODE=off` até o plugin ser atualizado.

## Privacidade

- Nenhuma chamada de rede, em nenhum gancho ou script.
- Os ganchos leem o transcript (Claude Code) ou o rollout (Codex) da sessão atual. Olham só contagem de tokens e, no Codex, `originator` e `source` da primeira linha. Nunca imprimem nem guardam o resto do cabeçalho.
- O arquivo de passagem tem o que o modelo escreveu sobre o seu trabalho, e isso pode incluir dados de cliente ou de projeto. Ele fica numa pasta dentro do seu perfil de usuário, nunca no repositório. No macOS e no Linux o plugin mantém a pasta padrão no modo `0700` (cria assim e aperta uma já existente que seja sua). Uma pasta definida em `handoff_dir` fica com a permissão que já tem, então proteja-a você mesmo. Nos dois casos o plugin recusa pasta que seja link simbólico ou de outro usuário.
- Passagem que uma sessão pegou é renomeada para `*.usada.md`.
- Arquivos com mais de 7 dias são apagados quando uma sessão começa, só os com nomes que o plugin grava. Em qualquer pasta, padrão ou configurada: `_req-N.txt`, `_detect-*.flag` e `_trace-<8hex>.md`. Só na pasta padrão: os `.md` de passagem (`<slug>[-<8hex>].md` e `.usada.md`). Uma pasta definida em `handoff_dir` nunca perde uma nota sua.
- A faixa guarda um arquivo de rastro por sessão na pasta de passagens (`_trace-<id8>.md`: eventos e tempos, as últimas 200 linhas, nunca o texto da passagem).

## A troca compensa?

Abaixo está a única medição que fizemos. As economias que vêm depois dela são estimativas.

Medido (Claude Code 2.1.328, `claude -p`, 7 execuções, haiku e opus): uma sessão nova não começa do zero. Um prefixo de cerca de 70.000 tokens (prompt de sistema, ferramentas, CLAUDE.md, memória) veio em boa parte do cache, mas de forma irregular: de 0 a cerca de 68.000 tokens foram escritos no cache na primeira mensagem. A escrita foi de 0 token em 2 das 7 execuções, de cerca de 31.000 em 2 (30.920 e 31.399) e entre 48.000 e 68.000 nas outras 3. Não descobrimos por que varia.

Estimado, com preços supostos (leitura de cache 0,1x, escrita de cache de 1 hora 2x, saída 5x; não conferimos na tabela de preços): com a troca a 150.000 tokens, o custo da passagem e da abertura da sessão nova se paga em cerca de 10 turnos com o cache quente e cerca de 27 com o cache frio. Com limite de 100.000, a mesma estimativa dá cerca de 24 a cerca de 70 turnos. Por isso o padrão é 150.000 e não recomendamos limite abaixo de uns 100.000. A estimativa não conta o outro motivo para trocar, que é o contexto muito longo piorar a resposta; isso não medimos.

Custo do gancho, medido: 50 chamadas de `PreToolUse` pelo Git Bash no Windows, com o `python3` sendo o Python 3.14 (o atalho que os ganchos chamam), levaram mediana de 196 ms e percentil 90 de 225 ms por chamada. Outros sistemas e versões do Python não foram medidos.

## Limites conhecidos

- O suporte ao Codex não foi testado na v0.1.0. O plugin foi instalado e o gancho foi conferido sem modelo, mas não houve teste numa sessão real do Codex: a trava, o aviso de contexto e a passagem ainda não foram vistos funcionando lá. Os testes estão previstos para a próxima versão. O comando do gancho no Codex lê `PLUGIN_ROOT`, a variável que um gancho de plugin do Codex 0.170 foi medido recebendo, e recorre a `CLAUDE_PLUGIN_ROOT`.
- A trava depende de sinais que os CLIs não documentam: `CLAUDE_CODE_ENTRYPOINT`, `agent_id` na entrada do `PreToolUse` do Claude Code, e `originator` e `source` no rollout do Codex. Uma atualização do CLI pode mudá-los. Se o plugin não consegue ler o sinal, desliga a trava naquela sessão e avisa uma vez. Se o `agent_id` sumir, os subagentes são negados; veja Como desligar.
- O Codex só roda ganchos de plugin depois que você os aprova em `/hooks`. Gancho não aprovado falha em silêncio.
- A gravação da passagem fica fora da pasta do seu projeto. No Claude Code o núcleo a pré-aprova nas condições de Permissão da gravação da passagem. Se faltar o `CLAUDE_PID` ou se o diretório de trabalho mudar antes do `Write`, o Claude Code pode pedir confirmação. Suas regras `deny` e `ask` continuam valendo.
- O Codex enxerga por 30 minutos as passagens que o Claude Code gravou num diretório. Uma sessão do Codex aberta no mesmo diretório entre a gravação e o `/clear` leva a passagem.
- Sem `CLAUDE_PID`, o `/clear` só entrega quando existe exatamente uma passagem recente do diretório.
- O começo de uma sessão recebe no máximo 9.000 caracteres de contexto: passagem desse tamanho é cortada, e a tabela de roteamento pode ser cortada ou ficar de fora.
- Um `handoff_dir` que passa na regra mas não pode ser usado, como um link ou uma junção, não é percebido pela faixa: o núcleo cai na pasta padrão e os dois olham pastas diferentes. Use uma pasta comum sua.
- A faixa depende da API de mods em acesso antecipado.
- Só o Windows foi testado.
- Outras ferramentas fazem coisas parecidas. Não rodamos nenhuma delas, então não há comparação aqui.

## Testes

O núcleo tem 76 testes (um é pulado no Windows porque confere modos de pasta POSIX) e a faixa 161.

```
python -I tests/test_core.py
claude plugin test plugins/synclabs-relay-band
claude plugin validate --strict plugins/synclabs-relay
```

## Segurança e versões

Veja [SECURITY.md](SECURITY.md). As notas de versão estão em [CHANGELOG.md](CHANGELOG.md).
