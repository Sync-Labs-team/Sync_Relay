import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register, Timer } from 'claude-code'

import type { PassagemFase } from '../types'

const tokens = atom({ plugin: 'synclabs-relay-band', key: 'tokens' } as const, null)
// piso: menor contexto visto desde o session.start ou /clear (o que a sessao ja nasce carregando).
const piso = atom({ plugin: 'synclabs-relay-band', key: 'piso' } as const, null)
const adiado = atom({ plugin: 'synclabs-relay-band', key: 'adiado' } as const, null)
const fase = atom({ plugin: 'synclabs-relay-band', key: 'fase' } as const, 'ocioso' as PassagemFase)
// Modo automatico: ligado (persiste em $.store, chave 'auto'), sessao interativa e segundos que faltam na contagem.
const auto = atom({ plugin: 'synclabs-relay-band', key: 'auto' } as const, false)
// Apresentacao unica da primeira instalacao: vista (persiste em $.store, chave 'apresentado'). O padrao do auto e desligado.
const apresentado = atom({ plugin: 'synclabs-relay-band', key: 'apresentado' } as const, false)
// Botao fixo "Passagem auto" acima do campo (sem faixa): visivel por padrao; /handoff botao alterna (store, chave 'botao').
const botaoFixo = atom({ plugin: 'synclabs-relay-band', key: 'botao' } as const, true)
const interativo = atom({ plugin: 'synclabs-relay-band', key: 'interativo' } as const, false)
const restante = atom({ plugin: 'synclabs-relay-band', key: 'restante' } as const, 0)
// A espera por agentes passou de 60 s: a faixa oferece "Trocar mesmo assim".
const demorou = atom({ plugin: 'synclabs-relay-band', key: 'demorou' } as const, false)
// O $.state e por sessao (id): depois do /clear a sessao nova nasce com os padroes. Ate o iniciar() dela, nada e desenhado.
const carregado = atom({ plugin: 'synclabs-relay-band', key: 'carregado' } as const, false)

// Default switch point: tokens ABOVE the session baseline (piso). Overridden by config `threshold_tokens`, by
// /handoff threshold (store, key 'limiar') and, for one session, by SYNCLABS_RELAY_BAND_THRESHOLD.
export const LIMIAR_ACIMA = 150_000
const LIMIAR_MIN = 5_000
const LIMIAR_MAX = 900_000
const limiar = atom({ plugin: 'synclabs-relay-band', key: 'limiar' } as const, LIMIAR_ACIMA)
// "Depois" (e Cancelar) esconde a faixa ate o contexto crescer mais isto.
const DE_NOVO = 50_000
// Aviso antes da troca automatica, em segundos.
export const CONTAGEM_S = 15
// Teto de espera em escrevendo (arquivo ainda nao gravado, agente vivo): estourou, e falha.
export const TETO_ESCRITA_MS = 10 * 60_000
// A handoff counts for the "opened" toast only if written in the last 30 min (the core's validity). The band never
// delivers it: the core SessionStart hook of the new session does, in both CLIs (one owner per delivery).
const VALIDADE_MS = 30 * 60_000
// O clique so conta a passagem gravada depois dele (uma velha no mesmo caminho nao serve).
let pedidoEm = 0
// A troca em andamento nasceu do modo automatico: cancelar ou falhar adia 50k em vez de repetir a cada turno.
let automatica = false
// Handles vivos. Estado do modulo: some no hot reload (every para; after termina), a fase confere antes de agir.
let contagem: Timer | null = null
// escrevendo: sondagem e /clear ja agendados (um de cada, para nao empilhar timers).
let sondando = false
let limpando = false
// Turno da principal em andamento (turn.start) e o que corria quando a passagem foi enviada: o fim desse turno
// ANTERIOR nao e o da passagem (ela entra na fila atras dele) e nao pode declarar falha.
let rodando: string | null = null
let anterior: string | null = null
const esperas = new Set<Timer>()
// Espera por agente vivo: passou disto, a faixa mostra "Trocar mesmo assim".
const DEMORA_MS = 60_000
// Espera em curso (uma contagem de 60 s por etapa), geracao para o timer velho nao agir e "Trocar mesmo assim" ja apertado.
let esperando = false
let geracao = 0
let forcado = false
// Toast "nao achei a pasta do usuario" ja mostrado nesta sessao.
let avisouSemPasta = false
// A sessao e interativa? Do modulo, porque o $.state zera no /clear e o motor nao dispara session.start nele.
let interativoModulo = false

/** FNV-1a 32 bits over the UTF-8 bytes (a lone surrogate is '?', like Python's errors="replace"), 8 lowercase hex digits. */
function fnv1a(texto: string): string {
  let h = 0x811c9dc5
  const byte = (b: number) => {
    h = Math.imul(h ^ b, 0x01000193) >>> 0
  }
  for (const ch of texto) {
    const c = ch.codePointAt(0)!
    if (c >= 0xd800 && c <= 0xdfff) byte(0x3f)
    else if (c < 0x80) byte(c)
    else if (c < 0x800) (byte(0xc0 | (c >> 6)), byte(0x80 | (c & 63)))
    else if (c < 0x10000) (byte(0xe0 | (c >> 12)), byte(0x80 | ((c >> 6) & 63)), byte(0x80 | (c & 63)))
    else (byte(0xf0 | (c >> 18)), byte(0x80 | ((c >> 12) & 63)), byte(0x80 | ((c >> 6) & 63)), byte(0x80 | (c & 63)))
  }
  return h.toString(16).padStart(8, '0')
}

/** The path as it came; on Windows lowercase and '/' -> '\\'; no trailing separator (a root keeps it). */
function normalizarCwd(cwd: string, windows: boolean): string {
  let c = windows ? cwd.toLowerCase().replaceAll('/', '\\') : cwd
  const sep = windows ? '\\' : '/'
  while (c.length > 1 && c.endsWith(sep) && !(windows && /^[a-z]:\\$/.test(c))) c = c.slice(0, -1)
  return c
}

/**
 * Handoff file name base for a directory: <readable part>-<h8>. Repeats slug() of the core script: change both
 * (locked by tests/vectors/paths.json). `windows` picks the normalization, like os.name in the core.
 */
export function slug(cwd: string, windows: boolean): string {
  const c = normalizarCwd(cwd, windows)
  const legivel = c.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(-60).replace(/^-+/, '')
  return legivel ? `${legivel}-${fnv1a(c)}` : fnv1a(c)
}

/** File name of this session: <slug(cwd)>-<id[:8]>.md, same as the core script (one file per session). */
export function nomeArquivo(cwd: string, id: string, windows: boolean): string {
  return `${slug(cwd, windows)}${id ? '-' + id.slice(0, 8) : ''}.md`
}

export function deveAvisar(
  n: number | null,
  pisoEm: number | null,
  adiadoEm: number | null,
  f: PassagemFase,
  lim: number = LIMIAR_ACIMA,
): boolean {
  if (f !== 'ocioso' || n === null || pisoEm === null || n - pisoEm < lim) return false
  return adiadoEm === null || n >= adiadoEm + DE_NOVO
}

type Lang = 'en' | 'pt-BR'
type Env = Record<string, string | undefined>

/** Default handoff folder (contract: tests/vectors/paths.json). null when there is no base to build it from. */
export function defaultHandoffDir(windows: boolean, env: Env, home: string | null): string | null {
  if (windows) {
    const base = env.LOCALAPPDATA || (home ? `${home}\\AppData\\Local` : '')
    return base ? `${base}\\synclabs-relay\\handoffs` : null
  }
  const base = env.XDG_STATE_HOME || (home ? `${home}/.local/state` : '')
  return base ? `${base}/synclabs-relay/handoffs` : null
}

/** Config file: SYNCLABS_RELAY_CONFIG, else $XDG_CONFIG_HOME, else %APPDATA% (Windows), else ~/.config. */
export function configFile(windows: boolean, env: Env, home: string | null): string | null {
  if (env.SYNCLABS_RELAY_CONFIG) return env.SYNCLABS_RELAY_CONFIG
  const base = env.XDG_CONFIG_HOME || (windows ? env.APPDATA || (home ? `${home}\\AppData\\Roaming` : '') : home ? `${home}/.config` : '')
  return base ? `${base}${windows ? '\\' : '/'}synclabs-relay${windows ? '\\' : '/'}config.json` : null
}

/** Same parse as the core script: pt, pt-br, pt_BR, pt-* -> pt-BR; en, en-*, en_* -> en (any case); else undefined. */
function langConhecido(v: string | undefined): Lang | undefined {
  const m = /^(pt|en)(?:[-_].*)?$/is.exec(v ?? '')
  return m ? (m[1].toLowerCase() === 'pt' ? 'pt-BR' : 'en') : undefined
}

/** Language: SYNCLABS_RELAY_LANG if it names one we know, then config `lang`, then the locale: pt* -> pt-BR, else en. */
export function resolveLang(envLang: string | undefined, cfgLang: string | undefined, locale: string): Lang {
  return langConhecido(envLang) ?? langConhecido(cfgLang) ?? (locale.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en')
}

type Config = { lang?: string; threshold?: number; dir?: string }

/**
 * handoff_dir, same rule as the core script (tests/vectors/paths.json): '~' at the start expands to home; Windows needs
 * a drive (C:\ or C:/) or UNC (\\srv\share), POSIX a '/'; no '..' segment (Windows strips trailing dots and spaces, so
 * '.. ' and '...' count). undefined = use the default folder.
 */
function pastaConfigurada(valor: string, windows: boolean, home: string | null): string | undefined {
  let d = valor
  if (d === '~' || d.startsWith('~/') || d.startsWith('~\\')) {
    if (!home) return undefined
    d = home + d.slice(1)
  }
  const ok = windows ? /^([A-Za-z]:[\\/]|\\\\[^\\/]+\\[^\\/])/.test(d) : d.startsWith('/')
  return ok && !/(^|[\\/])\.\.[. ]*([\\/]|$)/.test(d) ? d : undefined
}

/** Reads the config file (BOM stripped). Missing or invalid file or key: that key is ignored, never an error. */
export function parseConfig(txt: string, windows = false, home: string | null = null): Config {
  try {
    const o = JSON.parse(txt.replace(/^﻿/, ''))
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return {}
    const c: Config = {}
    if (typeof o.lang === 'string') c.lang = o.lang
    if (Number.isInteger(o.threshold_tokens) && o.threshold_tokens >= LIMIAR_MIN && o.threshold_tokens <= LIMIAR_MAX) c.threshold = o.threshold_tokens
    // an absolute path only: a relative one would write into whatever the cwd is (rule in pastaConfigurada)
    const dir = typeof o.handoff_dir === 'string' ? pastaConfigurada(o.handoff_dir, windows, home) : undefined
    if (dir) c.dir = dir
    return c
  } catch {
    return {}
  }
}

type Ambiente = { windows: boolean; env: Env; home: string | null; config: Config }

/**
 * Where things live, from env, session info and the config file. The real engine gives no configRoot, so when HOME or
 * USERPROFILE are missing the home comes from the transcript path (<home>/.claude/projects/...) or CLAUDE_PLUGIN_DATA.
 * shortcut: the config file is read on every call (a few hundred bytes); cache it if it ever shows in a profile.
 */
async function ambiente($: Engine): Promise<Ambiente> {
  const info = await $.session.info()
  const windows = info.platform === 'windows'
  // $.env.get needs a literal name at each call site (the engine lists the variables a module reads).
  const g = (v: string | undefined | Promise<string | undefined>): Promise<string | undefined> => Promise.resolve(v).then(x => x || undefined, () => undefined)
  const [LOCALAPPDATA, APPDATA, XDG_STATE_HOME, XDG_CONFIG_HOME, HOME, USERPROFILE, SYNCLABS_RELAY_CONFIG, SYNCLABS_RELAY_LANG] = await Promise.all([
    g($.env.get('LOCALAPPDATA')),
    g($.env.get('APPDATA')),
    g($.env.get('XDG_STATE_HOME')),
    g($.env.get('XDG_CONFIG_HOME')),
    g($.env.get('HOME')),
    g($.env.get('USERPROFILE')),
    g($.env.get('SYNCLABS_RELAY_CONFIG')),
    g($.env.get('SYNCLABS_RELAY_LANG')),
  ])
  const env: Env = { LOCALAPPDATA, APPDATA, XDG_STATE_HOME, XDG_CONFIG_HOME, HOME, USERPROFILE, SYNCLABS_RELAY_CONFIG, SYNCLABS_RELAY_LANG }
  const dados = await $.process.hookEnv().then(e => e.CLAUDE_PLUGIN_DATA, () => undefined)
  const from = (p: string | undefined, re: RegExp): string | null => re.exec(p ?? '')?.[1] ?? null
  const fromPath =
    from(info.transcriptPath, /^(.+?)[\\/]\.claude[\\/]projects[\\/]/i) ??
    from(dados, /^(.+?)[\\/]\.claude[\\/]plugins[\\/]/i) ??
    from(info.configRoot, /^(.+?)[\\/]\.claude[\\/]?$/i)
  const home = (windows ? env.USERPROFILE : env.HOME) || fromPath
  const arq = configFile(windows, env, home === null ? null : windows ? home.replaceAll('/', '\\') : home)
  let config: Config = {}
  if (arq !== null) {
    try {
      config = parseConfig(String(await $.fs.read(arq)), windows, home === null ? null : windows ? home.replaceAll('/', '\\') : home)
    } catch {
      // no config file: defaults
    }
  }
  return { windows, env, home, config }
}

/**
 * Handoff folder: config `handoff_dir`, else the default (see defaultHandoffDir). null: no home, so no right place
 * (never a relative path or a root).
 */
async function pastaPassagens($: Engine): Promise<string | null> {
  const { windows, env, home, config } = await ambiente($)
  const dir = config.dir ?? defaultHandoffDir(windows, env, home === null ? null : windows ? home.replaceAll('/', '\\') : home)
  return dir === null ? null : dir.replaceAll('\\', '/')
}


// User-visible text. pt-BR is the original wording; a missing key falls back to en.
const MSG = {
  en: {
    ready: 'Handoff saved. Type /clear to open the new session with it.',
    postponed: 'Switch postponed: you sent a message',
    submitFail: "Couldn't request the handoff; try again",
    notWritten: 'The handoff was not written; the session continues. Click again or type /handoff.',
    noFolder: 'handoff: could not find the user folder',
    clearRefused: 'handoff: /clear refused ({0}); handoff at {1}',
    canceledAutoOff: 'Switch canceled and auto turned off. To turn it back on: /handoff auto{0}',
    autoOn: 'Automatic switch on',
    autoOff: 'Automatic switch off',
    buttonShown: 'Button visible.',
    buttonHidden: 'Button hidden. To show it again: /handoff button.',
    thisSession: ' (this session only (SYNCLABS_RELAY_BAND_*))',
    canceledKeep: 'Switch canceled; the handoff stays at {0}',
    opened: 'Handoff saved; new session opened.',
    statusName: 'handoff',
    statusNameAuto: 'handoff auto',
    switching: 'handoff · switching…',
    measuring: 'measuring',
    cmdDescription: 'Writes this session\'s handoff and opens a new one with it. "/handoff auto" turns the automatic switch on or off; "/handoff button" hides or shows the button; "/handoff threshold" shows or sets the limit.',
    invalid: 'Invalid value: use {0} to {1} (e.g. 150k or 150000) or "default".',
    threshold: 'Threshold: +{0} above the baseline{1}',
    usage: 'Usage: /handoff (switch now), /handoff auto (turn the automatic mode on or off), /handoff button (hide or show the button) or /handoff threshold [Nk|default].',
    alreadySaved: 'The handoff is already saved at {0}. Type /clear to open the new session with it.',
    alreadyWriting: 'Already writing the handoff.',
    alreadyWaiting: 'Already waiting for the agents to finish before writing the handoff.',
    started: 'Writing the handoff; the new session opens by itself when it is ready.',
    agentOne: 'agent',
    agentMany: 'agents',
    waitingFor: 'Waiting for {0} {1}…',
    forceSwitch: 'Switch anyway',
    cancel: 'Cancel',
    writing: 'Writing the handoff to open the new session...',
    counting: 'Automatic switch in {0} s · Cancel to stop',
    now: 'Now',
    waitingToWrite: 'Waiting for {0} {1} to write the handoff...',
    agentOneFinish: 'agent to finish',
    agentManyFinish: 'agents to finish',
    intro: 'Session handoff: when the context grows {0}k above the start of the session, the band writes a handoff and opens a new session with it.',
    introAutoOn: 'Automatic on: switches by itself after {0} s, and you can cancel. Off: you get the warning and decide.',
    introAutoOff: 'Automatic off: you get the warning and decide. On: switches by itself after {0} s, and you can cancel.',
    introHow: 'On/off: button above the input or /handoff auto; /handoff button hides the button.',
    gotIt: 'Got it',
    turnAutoOff: 'Turn auto off',
    turnAutoOn: 'Turn auto on',
    autoButtonOn: 'Auto handoff: on',
    autoButtonOff: 'Auto handoff: off',
    banner: 'Context at {0}k tokens (+{1}k above the start of the session): past the switch point.',
    switchSession: 'Switch session',
    later: 'Later',
  },
  'pt-BR': {
    ready: 'Passagem gravada. Digite /clear para abrir a sessão nova já com ela.',
    postponed: 'Troca adiada: você mandou uma mensagem',
    submitFail: 'Não consegui pedir a passagem; tente de novo',
    notWritten: 'A passagem não foi gravada; a sessão continua. Clique de novo ou digite /handoff.',
    noFolder: 'passagem: não achei a pasta do usuário',
    clearRefused: 'passagem: /clear recusado ({0}); passagem em {1}',
    canceledAutoOff: 'Troca cancelada e automático desligado. Para religar: /handoff auto{0}',
    autoOn: 'Troca automática ligada',
    autoOff: 'Troca automática desligada',
    buttonShown: 'Botão visível.',
    buttonHidden: 'Botão oculto. Para mostrar de novo: /handoff botao.',
    thisSession: ' (só nesta sessão (SYNCLABS_RELAY_BAND_*))',
    canceledKeep: 'Troca cancelada; a passagem continua em {0}',
    opened: 'Passagem gravada; sessão nova aberta.',
    statusName: 'passagem',
    statusNameAuto: 'passagem auto',
    switching: 'passagem · trocando…',
    measuring: 'medindo',
    cmdDescription: 'Grava a passagem desta sessão e abre uma nova já com ela. "/handoff auto" liga ou desliga a troca automática; "/handoff botao" esconde ou mostra o botão; "/handoff limiar" mostra ou muda o limite.',
    invalid: 'Valor inválido: use de {0} a {1} (ex.: 150k ou 150000) ou "padrao".',
    threshold: 'Limiar: +{0} acima do piso{1}',
    usage: 'Uso: /handoff (troca agora), /handoff auto (liga ou desliga o modo automático), /handoff botao (esconde ou mostra o botão) ou /handoff limiar [N k|padrao].',
    alreadySaved: 'A passagem já está gravada em {0}. Digite /clear para abrir a sessão nova com ela.',
    alreadyWriting: 'Já estou gravando a passagem.',
    alreadyWaiting: 'Já estou aguardando os agentes terminarem para gravar a passagem.',
    started: 'Gravando a passagem; a sessão nova abre sozinha quando ela estiver pronta.',
    agentOne: 'agente',
    agentMany: 'agentes',
    waitingFor: 'Aguardando {0} {1}…',
    forceSwitch: 'Trocar mesmo assim',
    cancel: 'Cancelar',
    writing: 'Gravando a passagem para abrir a sessão nova...',
    counting: 'Troca automática em {0} s · Cancelar para parar',
    now: 'Agora',
    waitingToWrite: 'Aguardando {0} {1} para gravar a passagem...',
    agentOneFinish: 'agente terminar',
    agentManyFinish: 'agentes terminarem',
    intro: 'Passagem de sessão: quando o contexto passa {0}k acima do início da sessão, o mod grava uma passagem e abre uma sessão nova com ela.',
    introAutoOn: 'Automático ligado: troca sozinho depois de {0} s, e dá para cancelar. Desligado: você recebe o aviso e decide.',
    introAutoOff: 'Automático desligado: você recebe o aviso e decide. Ligado: troca sozinho depois de {0} s, e dá para cancelar.',
    introHow: 'Liga/desliga: botão acima do campo ou /handoff auto; /handoff botao oculta o botão.',
    gotIt: 'Entendi',
    turnAutoOff: 'Desligar automático',
    turnAutoOn: 'Ligar automático',
    autoButtonOn: 'Passagem auto: ligado',
    autoButtonOff: 'Passagem auto: desligado',
    banner: 'Contexto em {0}k tokens (+{1}k acima do início da sessão): passou do ponto de troca.',
    switchSession: 'Trocar de sessão',
    later: 'Depois',
  },
} as const
type MsgKey = keyof (typeof MSG)['en']
// Language of the session, set when the state loads (iniciar). shortcut: a module variable, one process = one language.
let lang: Lang = 'en'
const tx = (k: MsgKey, ...a: (string | number)[]): string =>
  ((MSG[lang] as Record<string, string>)[k] ?? MSG.en[k]).replace(/\{(\d)\}/g, (_, i) => String(a[Number(i)] ?? ''))

/** Handoff folder (or null), cwd and session id, and the file of THIS session (same folder and name rule as the core script). */
async function contexto($: Engine): Promise<{ pasta: string | null; cwd: string; id: string; arq: string }> {
  const [pasta, cwd, id, info] = await Promise.all([pastaPassagens($), $.session.cwd(), $.session.id(), $.session.info()])
  return { pasta, cwd, id, arq: pasta === null ? '' : `${pasta}/${nomeArquivo(cwd, id, info.platform === 'windows')}` }
}

async function arquivo($: Engine): Promise<string> {
  return (await contexto($)).arq
}

// Trace: one line per event in <folder>/_trace-<id8>.md, metadata only (never the handoff text), last 200 lines.
// Diagnostics for the real engine; never breaks the band: every failure is swallowed. One queue: no interleaved reads/writes.
// The trace lines stay in Portuguese (internal diagnostics, not user-facing text).
const RASTRO_LINHAS = 200
let fila: Promise<void> = Promise.resolve()
function rastro($: Engine, msg: string | (() => Promise<string>)): void {
  const hora = new Date().toISOString()
  fila = fila.then(async () => {
    try {
      const [pasta, id, texto] = await Promise.all([
        pastaPassagens($),
        $.session.id(),
        typeof msg === 'string' ? msg : msg(),
      ])
      if (pasta === null) return // sem pasta do usuario: o rastro fica calado
      const arq = `${pasta}/_trace-${id.slice(0, 8)}.md`
      let antes = ''
      try {
        antes = String(await $.fs.read(arq))
      } catch {
        // arquivo ainda nao existe
      }
      const linhas = String(antes).split('\n').filter(l => l !== '')
      linhas.push(`${hora} ${texto}`)
      await $.fs.write(arq, linhas.slice(-RASTRO_LINHAS).join('\n') + '\n')
    } catch {
      // o rastro e so diagnostico
    }
  })
}

// Vivo = pending ou running. Na API (AgentStatus): waiting = preso em trabalho de segundo plano que ele possui, em
// aprovacao de plano ou, em subagente de fundo, so numa chamada Agent; idle = entre turnos ate uma mensagem; completed/failed/killed = fim.
// waiting NAO segura a troca (4 agentes "waiting" fixos travavam a sessao bg): o /clear pode cortar o trabalho deles, risco aceito.
const LISTA_MS = 5000
let ultimoVivos = ''

// shortcut: agent.list sem resposta em 5 s conta como 1 agente vivo (nao envia, reconfere no tique); trocar por contagem real se a API ganhar timeout.
async function vivos($: Engine, motivo?: string): Promise<number> {
  // "Trocar mesmo assim" apertado: esta etapa nao espera mais ninguem.
  if (forcado) return 0
  let t: { cancel(): void } | undefined
  const limite = new Promise<number>(r => void (t = $.clock.after(LISTA_MS, () => r(1))))
  try {
    return await Promise.race([
      $.agent.list().then(l => {
        const n = l.filter(a => a.status === 'pending' || a.status === 'running').length
        if (motivo !== undefined) {
          const cont: Record<string, number> = {}
          for (const a of l) cont[a.status] = (cont[a.status] ?? 0) + 1
          const sig = `vivos=${n} status=${JSON.stringify(cont)}`
          // So quando muda: a sondagem de 2 s nao enche o arquivo.
          if (sig !== ultimoVivos) rastro($, `${sig} (${motivo})`)
          ultimoVivos = sig
        }
        return n
      }),
      limite,
    ])
  } finally {
    t?.cancel()
  }
}

/** Comeca a contar os 60 s da espera por agente (uma vez por etapa); passou, a faixa oferece "Trocar mesmo assim". */
function iniciarEspera($: Engine): void {
  if (esperando) return
  esperando = true
  const g = ++geracao
  depois($, DEMORA_MS, () => {
    if (g === geracao) void update($, demorou, () => true)
  })
}

/** A etapa de espera acabou (ou a troca voltou a ocioso): zera contagem, botao e "mesmo assim". */
async function zerarEspera($: Engine): Promise<void> {
  esperando = false
  forcado = false
  geracao += 1
  await update($, demorou, () => false)
}

/** "150k" ou "150000" -> tokens; null se nao for inteiro (k opcional) entre 5k e 900k. */
export function lerLimiar(txt: string): number | null {
  const m = /^(\d+)(k?)$/.exec(txt)
  if (m === null) return null
  const v = Number(m[1]) * (m[2] === 'k' ? 1000 : 1)
  return v >= LIMIAR_MIN && v <= LIMIAR_MAX ? v : null
}
const kt = (v: number): string => `${+(v / 1000).toFixed(1)}k`

// Override for this session only, for tests: SYNCLABS_RELAY_BAND_THRESHOLD and SYNCLABS_RELAY_BAND_AUTO (1/0) read by $.env.get at session.start. Com
// valor valido, auto e limiar valem no modulo (sobrevive ao /clear, mesmo processo) e NADA disso vai ao $.store, que e de todas
// as sessoes. Comando e botao mudam so este objeto.
let sobre: { auto?: boolean; limiar?: number; botao?: boolean } | null = null
const soSessao = (): string => (sobre ? tx('thisSession') : '')

async function lerSobrescrita($: Engine): Promise<void> {
  const [l, a] = await Promise.all([$.env.get('SYNCLABS_RELAY_BAND_THRESHOLD'), $.env.get('SYNCLABS_RELAY_BAND_AUTO')])
  const o: { auto?: boolean; limiar?: number } = {}
  const ruim: string[] = []
  if (l !== undefined && l !== '') {
    const v = lerLimiar(l.trim().toLowerCase())
    if (v === null) ruim.push(`SYNCLABS_RELAY_BAND_THRESHOLD="${l}"`)
    else o.limiar = v
  }
  if (a !== undefined && a !== '') {
    if (a.trim() === '1' || a.trim() === '0') o.auto = a.trim() === '1'
    else ruim.push(`SYNCLABS_RELAY_BAND_AUTO="${a}"`)
  }
  for (const r of ruim) rastro($, `sobrescrita env ignorada: ${r} invalido`)
  sobre = o.auto === undefined && o.limiar === undefined ? null : o
  if (sobre) rastro($, `sobrescrita env limiar=${sobre.limiar ?? '-'} auto=${sobre.auto === undefined ? '-' : sobre.auto ? 1 : 0}`)
}

/** Linha de status fixa ($.ui.status: uma por plugin, ao lado da statusLine do usuario): auto, quanto falta, ou trocando. */
async function indicar($: Engine): Promise<void> {
  if (!(await read($, interativo))) return
  const [f, ligado, n, pi, lim] = await Promise.all([read($, fase), read($, auto), read($, tokens), read($, piso), read($, limiar)])
  const nome = ligado ? tx('statusNameAuto') : tx('statusName')
  $.ui.status(
    f !== 'ocioso'
      ? tx('switching')
      : n === null || pi === null
        ? `${nome} · ${tx('measuring')}`
        : `${nome} · +${Math.round((n - pi) / 1000)}k/${kt(lim)}`,
  )
}

/** Troca a fase so se a atual for uma de `de` (null: qualquer) e deixa rastro. */
async function irPara($: Engine, de: PassagemFase[] | null, para: PassagemFase, motivo: string): Promise<void> {
  const antes = await read($, fase)
  await update($, fase, f => (de === null || de.includes(f) ? para : f))
  const agora = await read($, fase)
  if (agora !== antes) {
    rastro($, `fase ${antes} -> ${agora} (${motivo})`)
    await indicar($)
  }
}

let cancelando = false

function pararContagem(): void {
  contagem?.cancel()
  contagem = null
}

/** Cancela toda contagem e todo after pendente: nenhum timer sobra quando a fase sai deles. */
function cancelarTimers(): void {
  pararContagem()
  for (const t of esperas) t.cancel()
  esperas.clear()
  sondando = false
  limpando = false
}

function depois($: Engine, ms: number, fn: () => void): void {
  const t = $.clock.after(ms, () => {
    esperas.delete(t)
    fn()
  })
  esperas.add(t)
}

async function cancelarMarcador($: Engine): Promise<void> {
  try {
    const [pid, pasta] = await Promise.all([$.process.hookEnv().then(e => e.CLAUDE_PID, () => undefined), pastaPassagens($)])
    if (pasta !== null && /^[0-9]{1,10}$/.test(pid ?? '')) await $.fs.write(`${pasta}/_req-${pid}.txt`, '')
  } catch {
    // sem marcador vazio a troca ainda e cancelada na faixa; so o /clear digitado depois pode entregar
  }
}

/** Volta a ocioso cancelando timers; adiarEm poe o "Depois" (so sobe a faixa 50k tokens depois). */
async function ocioso($: Engine, adiarEm?: number | null, motivo = 'voltou a ocioso'): Promise<void> {
  cancelarTimers()
  automatica = false
  // Cancelou: a passagem ja gravada nao vale mais para um /clear digitado depois. Sem delete no fs, o marcador do
  // nucleo (_req-<CLAUDE_PID>.txt) e gravado vazio: vazio = cancelado, o nucleo nao entrega.
  const pedido = pedidoEm
  pedidoEm = 0
  if (pedido !== 0) await cancelarMarcador($)
  await zerarEspera($)
  await irPara($, null, 'ocioso', motivo)
  if (adiarEm !== undefined && adiarEm !== null) await update($, adiado, () => adiarEm)
}

/** A pessoa mandou mensagem no meio da troca: cancela (e, no modo automatico, adia como o Depois). */
async function mensagemDaPessoa($: Engine): Promise<void> {
  const n = await read($, tokens)
  await ocioso($, automatica ? n : undefined, 'mensagem da pessoa')
  $.ui.toast(tx('postponed'))
}

// Confere de novo a cada 2 s alem do fim de turno: o status do agente pode atualizar depois do evento.
const ESPERA_MS = 2000
// Voo unico: um so envio de "handoff" por troca (botao, Agora, /handoff ou fim da contagem), de comecar a avancar.
let enviando = false

/** So envia se a fase ainda e a esperada (a troca atomica de fase sobrevive a mensagem ou Cancelar durante o await). */
async function enviar($: Engine, esperada: PassagemFase): Promise<void> {
  const agora = await $.clock.now()
  await irPara($, [esperada], 'escrevendo', 'pedido enviado')
  if ((await read($, fase)) !== 'escrevendo') return
  await zerarEspera($)
  pedidoEm = agora
  anterior = rodando
  // The core UserPromptSubmit hook swaps "handoff" for the instructions and the file path.
  try {
    await $.prompt.submit({ text: 'handoff', asUser: true })
  } catch {
    if ((await read($, fase)) !== 'escrevendo') return
    await ocioso($, automatica ? await read($, tokens) : undefined, 'submit recusado')
    $.ui.toast(tx('submitFail'))
  }
}

/** Na fase aguardando: sem agente vivo, pede a passagem; com, volta a conferir. */
async function avancar($: Engine): Promise<void> {
  if (enviando || (await read($, fase)) !== 'aguardando') return
  if ((await vivos($, 'aguardando')) > 0) {
    depois($, ESPERA_MS, () => void avancar($))
    return
  }
  if ((await read($, fase)) !== 'aguardando') return
  enviando = true
  try {
    await enviar($, 'aguardando')
  } finally {
    enviando = false
  }
}

/** /clear so sem agente vivo: o /clear pode cortar o que roda em segundo plano (nao documentado, tratado como risco). */
async function limpar($: Engine): Promise<void> {
  if ((await read($, fase)) !== 'escrevendo') return
  if ((await vivos($, 'antes do /clear')) > 0) {
    iniciarEspera($)
    depois($, ESPERA_MS, () => void limpar($))
    return
  }
  if ((await read($, fase)) !== 'escrevendo') return
  // /clear fora do turno: dentro do gancho que o turno espera o engine recusa o comando.
  // command.run espera a sessao ficar livre (api: "queued and run once the session is idle"): sem agendar no turn.complete.
  rastro($, 'clear: chamando command.run')
  try {
    await $.command.run({ command: 'clear' })
    rastro($, 'clear: ok (command.run voltou)')
  } catch (err) {
    rastro($, `clear: recusado (${String(err)})`)
    if ((await read($, fase)) !== 'escrevendo') return
    // Recusado (ex.: sessao de segundo plano): a passagem esta gravada; a pessoa digita /clear e o fluxo segue no session.end.
    cancelarTimers()
    automatica = false
    await irPara($, null, 'pronta', '/clear recusado')
    $.ui.log(tx('clearRefused', String(err), await arquivo($)))
    $.ui.toast(tx('ready'))
  }
}

/**
 * Fase escrevendo: arquivo gravado -> /clear; nao gravado mas com agente vivo (a passagem pode estar sendo
 * escrita em segundo plano) -> espera, ate o teto; so um turno da principal sem arquivo e sem agente vivo, ou o
 * teto, declara falha (no modo automatico, adia 50k).
 */
async function conferir($: Engine, principal: boolean): Promise<void> {
  if ((await read($, fase)) !== 'escrevendo') return
  const arq = await arquivo($)
  const gravada = (await $.fs.exists(arq)) && (await $.fs.stat(arq)).mtimeMs >= pedidoEm - 1000
  if (gravada) {
    if (!limpando) {
      limpando = true
      depois($, 300, () => void limpar($))
    }
    return
  }
  const estourou = (await $.clock.now()) - pedidoEm >= TETO_ESCRITA_MS
  if (!estourou && (!principal || (await vivos($)) > 0)) {
    if (!sondando) {
      sondando = true
      depois($, ESPERA_MS, () => {
        sondando = false
        void conferir($, false)
      })
    }
    return
  }
  if ((await read($, fase)) !== 'escrevendo') return
  await ocioso($, automatica ? await read($, tokens) : undefined, 'passagem nao gravada')
  $.ui.toast(tx('notWritten'))
}

/** Da fase ocioso ou contando para a troca: envia ja ou espera os agentes vivos. */
async function comecar($: Engine): Promise<void> {
  if (enviando) return
  // Sem a pasta do usuario a passagem nao tem onde nascer: nao troca, avisa uma vez por sessao.
  if ((await pastaPassagens($)) === null) {
    if (!avisouSemPasta) $.ui.toast(tx('noFolder'))
    avisouSemPasta = true
    return await ocioso($, automatica ? await read($, tokens) : undefined, 'sem pasta do usuario')
  }
  enviando = true
  try {
    const antes = await read($, fase)
    if (antes !== 'ocioso' && antes !== 'contando') return
    const n = await vivos($, `inicio da troca (${antes})`)
    // Cancelar ou mensagem durante o agent.list mudou a fase: nao envia nem aguarda.
    if ((await read($, fase)) !== antes) return
    if (n === 0) return await enviar($, antes)
    await irPara($, [antes], 'aguardando', 'agente vivo')
    if ((await read($, fase)) === 'aguardando') iniciarEspera($)
  } finally {
    enviando = false
  }
  void avancar($)
}

/** Como enviar(), sem o envio: a mensagem digitada ja e o pedido. Vale em ocioso, contando e aguardando. */
async function comecarDigitada($: Engine): Promise<void> {
  const agora = await $.clock.now()
  pararContagem()
  await irPara($, ['ocioso', 'contando', 'aguardando'], 'escrevendo', 'passagem digitada')
  await zerarEspera($)
  pedidoEm = agora
  anterior = rodando
}

async function trocar($: Engine): Promise<void> {
  if ((await read($, fase)) !== 'ocioso') return
  return comecar($)
}

/** "Trocar mesmo assim": a etapa de espera (enviar ou /clear) segue sem esperar os agentes. */
async function forcar($: Engine): Promise<void> {
  const f = await read($, fase)
  if (f !== 'aguardando' && f !== 'escrevendo') return
  rastro($, `trocar mesmo assim (fase ${f})`)
  forcado = true
  cancelarTimers()
  if (f === 'aguardando') return avancar($)
  return limpar($)
}

/** Botao Agora: encerra a contagem e troca pelo mesmo fluxo. */
async function agora($: Engine): Promise<void> {
  if ((await read($, fase)) !== 'contando') return
  pararContagem()
  return comecar($)
}

/**
 * Cancelar a contagem (0.6.12): para a troca, adia 50k tokens como o Depois e DESLIGA o automatico (store; com a sobrescrita
 * SYNCLABS_RELAY_BAND_*, so a sessao). Mensagem da pessoa na contagem continua so adiando. Sem API documentada de tecla, o Esc nao existe.
 */
async function cancelarContagem($: Engine): Promise<void> {
  // read() e assincrono: so uma chamada passa daqui (duplo clique), a flag e sincrona.
  if (cancelando) return
  cancelando = true
  try {
    await cancelarUmaVez($)
  } finally {
    cancelando = false
  }
}

async function cancelarUmaVez($: Engine): Promise<void> {
  if ((await read($, fase)) !== 'contando') return
  const n = await read($, tokens)
  // 0.6.13: para a contagem e sai de 'contando' ANTES de qualquer await lento (store): 2o clique e o tique veem a fase ocioso.
  await ocioso($, n, 'cancelou a contagem')
  await guardarAuto($, false)
  rastro($, 'auto ligado -> desligado (botao)')
  $.ui.toast(tx('canceledAutoOff', soSessao()))
  await indicar($)
}

async function tique($: Engine): Promise<void> {
  if (contagem === null) return
  if ((await read($, fase)) !== 'contando') return pararContagem()
  const faltam = (await read($, restante)) - 1
  if (faltam > 0) return void (await update($, restante, () => faltam))
  pararContagem()
  await comecar($)
}

async function iniciarContagem($: Engine): Promise<void> {
  automatica = true
  await update($, restante, () => CONTAGEM_S)
  await irPara($, null, 'contando', 'modo automatico')
  pararContagem()
  contagem = $.clock.every(1000, () => void tique($))
}

/** Grava o auto no atomo e no store (com a sobrescrita SYNCLABS_RELAY_BAND_*, so na sessao). */
async function guardarAuto($: Engine, valor: boolean): Promise<void> {
  await update($, auto, () => valor)
  if (sobre) sobre.auto = valor
  else await $.store.set('auto', valor)
}

/** origem vai para o rastro: no motor real o auto ja mudou sem se saber por onde (botao, comando ou apresentacao). */
async function alternarAuto($: Engine, origem: string): Promise<boolean> {
  const novo = !(await read($, auto))
  await guardarAuto($, novo)
  rastro($, `auto ${novo ? 'desligado -> ligado' : 'ligado -> desligado'} (${origem})`)
  // Desligou no meio da contagem: ela nao vale mais (nao adia: so deixou de ser automatica).
  if (!novo && (await read($, fase)) === 'contando') await ocioso($, undefined, 'auto desligado')
  $.ui.toast(`${novo ? tx('autoOn') : tx('autoOff')}${soSessao()}`)
  await indicar($)
  return novo
}

/** Esconde ou mostra o botao fixo. Com a sobrescrita SYNCLABS_RELAY_BAND_* ativa vale so na sessao (como o auto e o limiar). */
async function alternarBotao($: Engine, origem: string): Promise<string> {
  const novo = !(await read($, botaoFixo))
  await update($, botaoFixo, () => novo)
  if (sobre) sobre.botao = novo
  else await $.store.set('botao', novo)
  rastro($, `botao ${novo ? 'oculto -> visivel' : 'visivel -> oculto'} (${origem})`)
  const msg = `${novo ? tx('buttonShown') : tx('buttonHidden')}${soSessao()}`
  $.ui.toast(msg)
  return msg
}

/** Fecha a apresentacao unica; alternar=true tambem inverte o automatico (liga quem esta desligado, desliga quem esta ligado). */
async function apresentar($: Engine, alternar: boolean): Promise<void> {
  if (alternar) await alternarAuto($, 'apresentacao')
  if (!sobre) await $.store.set('apresentado', true)
  rastro($, `apresentacao fechada (${alternar ? 'alternar' : 'entendi'})`)
  await update($, apresentado, () => true)
}

const MAX_PISOS = 50
const LIMITE_LEITURA = 4_194_304 // $.fs.read do motor real recusa arquivo acima de 4 MiB (provado 19/11/2026)
type PisoSalvo = { piso: number; em: number }

/** Pisos por sessao no $.store (chave 'pisos'): o transcript de sessao grande passa de 4 MiB e nao da para le-lo. */
async function lerPisos($: Engine): Promise<Record<string, PisoSalvo>> {
  const v = await $.store.get('pisos').catch(() => undefined)
  return v !== null && typeof v === 'object' ? (v as Record<string, PisoSalvo>) : {}
}

/** Grava o piso desta sessao se for o 1o ou se baixou; acima de MAX_PISOS entradas, descarta as de menor `em`. */
async function guardarPiso($: Engine, id: string, piso: number): Promise<void> {
  try {
    const pisos = await lerPisos($)
    if (typeof pisos[id]?.piso === 'number' && pisos[id].piso <= piso) return
    pisos[id] = { piso, em: await $.clock.now() }
    const ids = Object.keys(pisos).sort((a, b) => (pisos[a]?.em ?? 0) - (pisos[b]?.em ?? 0))
    for (const velho of ids.slice(0, Math.max(0, ids.length - MAX_PISOS))) delete pisos[velho]
    await $.store.set('pisos', pisos)
  } catch (err) {
    rastro($, `piso nao guardado no store (${err instanceof Error ? err.message : String(err)})`)
  }
}

async function esquecerPiso($: Engine, ids: string[]): Promise<void> {
  try {
    const pisos = await lerPisos($)
    const tem = ids.filter(i => i in pisos)
    if (tem.length === 0) return
    for (const i of tem) delete pisos[i]
    await $.store.set('pisos', pisos)
  } catch {
    // sem store, a sessao nova mede pela reserva
  }
}

/**
 * Piso medido no 1o turno depois de session.start/reload: o 1o usage de assistente do transcript DEPOIS do ultimo /clear ou
 * compactacao (o contexto com que a sessao nasceu), nunca acima de n. Le o arquivo uma vez; sem caminho, leitura ou usage: n.
 * shortcut: le o transcript inteiro (centenas de MB numa sessao enorme), trocar por leitura de trecho se pesar.
 */
async function pisoDoTranscript($: Engine, n: number): Promise<number> {
  try {
    const caminho = (await $.session.info()).transcriptPath
    if (!caminho) throw new Error('sem transcriptPath')
    const tam = await $.fs.stat(caminho).then(st => st.size, () => undefined)
    if (tam !== undefined && tam > LIMITE_LEITURA) throw new Error(`transcript com ${tam} bytes, acima do limite de leitura de 4 MiB`)
    let achado: number | null = null
    for (const l of String(await $.fs.read(caminho)).split('\n')) {
      const limite = l.includes('compact_boundary') || l.includes('command-name>/clear')
      if (!limite && (achado !== null || !l.includes('"usage"'))) continue
      let o: any
      try {
        o = JSON.parse(l)
      } catch {
        continue
      }
      const c = o?.message?.content
      if (o?.type === 'system' ? o.subtype === 'compact_boundary' : o?.type === 'user' && typeof c === 'string' && c.startsWith('<command-name>/clear</command-name>')) achado = null
      else if (achado === null && o?.type === 'assistant' && o.isSidechain !== true) {
        const u = o.message?.usage
        const t = (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0)
        if (t > 0) achado = t
      }
    }
    if (achado === null) throw new Error('nenhum usage de assistente')
    return Math.min(achado, n)
  } catch (err) {
    rastro($, `piso do transcript indisponivel (${err instanceof Error ? err.message : String(err)}); piso=${n}`)
    return n
  }
}

type Via = 'session.start' | 'clear-timer' | 'turno' | 'comando'
// O ultimo carregamento nao leu o store: o proximo turno ou comando tenta de novo (o estado ja desenhado segue valendo).
let carregouEmFalha = false

/**
 * Estado de sessao: o $.state zera no /clear (sem session.start), entao session.start e o timer do session.end clear chamam
 * isto com sessao NOVA (piso e fase de partida). Turno e comando so completam o que falta (hot reload numa sessao aberta):
 * o interativo, o piso e a fase que a sessao ja tem ficam. Store ilegivel: padroes (ou SYNCLABS_RELAY_BAND_*), sem lancar.
 */
async function iniciar($: Engine, via: Via, ehInterativo = interativoModulo): Promise<void> {
  let falha: string | null = null
  const lerStore = async (k: string): Promise<unknown> => {
    try {
      return await $.store.get(k)
    } catch (err) {
      falha ??= err instanceof Error ? err.message : String(err)
      return undefined
    }
  }
  if (via === 'session.start' || via === 'clear-timer') {
    await update($, piso, () => null)
    await update($, fase, () => 'ocioso')
  }
  // Interativo nunca cai de true para false fora do session.start: o modulo recem-recarregado nao sabe, a sessao sabe.
  const ligadoInterativo = via === 'session.start' ? ehInterativo : (await read($, interativo)) || interativoModulo
  interativoModulo = ligadoInterativo
  await update($, interativo, () => ligadoInterativo)
  const guardado = sobre?.auto ?? (await lerStore('auto')) === true
  await update($, auto, () => guardado)
  // Store ilegivel: sem apresentacao de primeira instalacao (ela gravaria no store que nao responde).
  const visto = (await lerStore('apresentado')) === true || falha !== null
  await update($, apresentado, () => visto)
  const mostrar = sobre?.botao ?? (await lerStore('botao')) !== false
  await update($, botaoFixo, () => mostrar)
  // Language and default threshold come from the env and the config file; the store (/handoff threshold) wins over the config.
  const amb = await ambiente($).catch((): Ambiente | null => null)
  lang = resolveLang(amb?.env.SYNCLABS_RELAY_LANG, amb?.config.lang, Intl.DateTimeFormat().resolvedOptions().locale)
  const lim = sobre?.limiar ?? (await lerStore('limiar'))
  const limite = typeof lim === 'number' && lim >= LIMIAR_MIN && lim <= LIMIAR_MAX ? lim : (amb?.config.threshold ?? LIMIAR_ACIMA)
  await update($, limiar, () => limite)
  await update($, carregado, () => true)
  carregouEmFalha = falha !== null
  if (falha !== null) rastro($, `carregar falhou: ${falha}; usando padroes`)
  rastro($, async () => `carregado via=${via} id=${(await $.session.id().catch(() => '')).slice(0, 8)} auto=${guardado} limiar=${limite} interativo=${ligadoInterativo}`)
  await indicar($)
}

/** Sessao sem estado (depois do /clear ou do hot reload): carrega antes de usar auto, limiar ou fase. Nunca lanca. */
async function carregar($: Engine, via: Via): Promise<void> {
  try {
    if ((await read($, carregado)) && !carregouEmFalha) return
    await iniciar($, via)
  } catch (err) {
    rastro($, `carregar falhou: ${err instanceof Error ? err.message : String(err)}; usando padroes`)
    await update($, carregado, () => true).catch(() => undefined)
  }
}

/**
 * Depois do /clear (motor 2.1.329, provado 20/11/2026): o session.end inteiro roda com o id antigo e o que ele grava no $.state
 * fica na sessao antiga; nao ha session.start. Um timer ja roda com o id novo (~80 ms): espera o id mudar (ate ~2 s) e carrega.
 */
function recarregar($: Engine, antigo: string, tentativa = 0): void {
  $.clock.after(20, async () => {
    try {
      const id = await $.session.id().catch(() => antigo)
      if (id === antigo && tentativa < 100) return recarregar($, antigo, tentativa + 1)
      await carregar($, 'clear-timer')
    } catch {
      // carregar nao lanca; o catch cobre o resto (rejeicao nao tratada derrubaria o timer)
    }
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    avisouSemPasta = false
    await lerSobrescrita($)
    await iniciar($, 'session.start', e.isInteractive)
    await $.command.register({ name: 'handoff', description: tx('cmdDescription') })
    rastro($, async () => `session.start id=${await $.session.id()} interativo=${e.isInteractive}`)
    return next(e)
  })

  on('command.run', { command: 'handoff' }, async ($, e) => {
    await carregar($, 'comando')
    const arg = e.args.trim().toLowerCase()
    if (arg === 'auto') {
      const novo = await alternarAuto($, 'comando')
      return { text: `${novo ? tx('autoOn') : tx('autoOff')}.${soSessao()}` }
    }
    if (arg === 'botao' || arg === 'button') return { text: await alternarBotao($, 'comando') }
    const [cmd, ...resto] = arg.split(/\s+/)
    if ((cmd === 'limiar' || cmd === 'threshold') && resto.length <= 1) {
      const pedido = resto[0]
      if (pedido !== undefined) {
        const v = pedido === 'padrao' || pedido === 'default' ? ((await ambiente($)).config.threshold ?? LIMIAR_ACIMA) : lerLimiar(pedido)
        if (v === null) return { text: tx('invalid', kt(LIMIAR_MIN), kt(LIMIAR_MAX)) }
        await update($, limiar, () => v)
        if (sobre) sobre.limiar = v
        else if (pedido === 'padrao' || pedido === 'default') await $.store.delete('limiar') // back to config -> default, not frozen at today's config value
        else await $.store.set('limiar', v)
        await indicar($)
      }
      return { text: tx('threshold', kt(await read($, limiar)), soSessao()) }
    }
    if (arg !== '') return { text: tx('usage') }
    const f = await read($, fase)
    if (f === 'pronta') return { text: tx('alreadySaved', await arquivo($)) }
    if (f === 'escrevendo') return { text: tx('alreadyWriting') }
    if (f === 'aguardando') return { text: tx('alreadyWaiting') }
    void (f === 'contando' ? agora($) : trocar($))
    return { text: tx('started') }
  })

  // Only the person's message (origin composer) cancels; the band's own "handoff" does not pass through this hook.
  // The band never adds context: the core SessionStart hook delivers the handoff to the new session.
  on('prompt.submit', async ($, e, next) => {
    const f = await read($, fase)
    // "handoff" (or "passagem") typed: the message itself carries the instructions (core hook), so this only marks the start.
    if (e.origin.kind === 'composer' && !e.command && ['handoff', 'passagem'].includes(e.text.trim().toLowerCase().replace(/^\//, ''))) {
      if (f === 'ocioso' || f === 'contando' || f === 'aguardando') await comecarDigitada($)
      return next(e)
    }
    if (f === 'pronta' && e.origin.kind === 'composer' && !e.command) {
      await ocioso($, undefined, 'mensagem na fase pronta')
      $.ui.toast(tx('canceledKeep', await arquivo($)))
    } else if (f !== 'ocioso' && e.origin.kind === 'composer' && !e.command) await mensagemDaPessoa($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) rodando = r.turnId
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && e.turnId === rodando) rodando = null
    if (e.agentId) {
      await avancar($)
      await conferir($, false)
      return r
    }
    // Estado zerado sem session.start (/clear) e ainda nao recarregado: carrega antes de medir.
    await carregar($, 'turno')
    const { context } = await $.session.usage()
    const n = context.tokens ?? null
    await update($, tokens, () => n)
    if (n !== null) {
      const id = await $.session.id().catch(() => '') // sem id nao ha piso guardado: so a reserva
      let real = n
      if ((await read($, piso)) === null) {
        // Ordem: piso guardado desta sessao, reserva (transcript, ate 4 MiB), n.
        const salvo = id === '' ? undefined : (await lerPisos($))[id]?.piso
        real = Math.min(typeof salvo === 'number' ? salvo : await pisoDoTranscript($, n), n)
      }
      await update($, piso, p => (p === null ? real : Math.min(p, n)))
      if (id !== '') await guardarPiso($, id, (await read($, piso)) ?? n)
    }
    await indicar($)
    rastro($, async () => `turno n=${n} piso=${await read($, piso)} interativo=${await read($, interativo)} auto=${await read($, auto)} limiar=${await read($, limiar)}`)
    await avancar($)
    const f = await read($, fase)
    if (f !== 'escrevendo') {
      // Contagem sem timer vivo (hot reload no meio): nao serve mais.
      if (f === 'contando' && contagem === null) await ocioso($, undefined, 'contagem sem timer')
      else if (f === 'ocioso' && (await read($, auto)) && (await read($, interativo))) {
        // Agente vivo: o auto nem comeca (o /clear nao para o agente, mas o aviso dele cairia na sessao nova sem contexto);
        // a faixa segue avisando e o turno do aviso do fim dele confere de novo.
        if (deveAvisar(n, await read($, piso), await read($, adiado), 'ocioso', await read($, limiar)) && (await vivos($, 'auto')) === 0)
          await iniciarContagem($)
      }
      return r
    }

    const doAnterior = anterior !== null && e.turnId === anterior
    if (doAnterior) anterior = null
    await conferir($, !doAnterior)
    return r
  })

  // Compactou: o numero velho some ate o proximo turno; compactacao vetada (skip) nao muda nada.
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (r.skip === undefined) {
      await update($, tokens, () => null)
      await update($, adiado, () => null)
      await indicar($)
      // A contagem nao faz mais sentido; a passagem ja pedida (escrevendo) segue.
      const f = await read($, fase)
      if (f === 'contando' || (f === 'aguardando' && automatica)) await ocioso($, undefined, 'compactou')
    }
    return r
  })

  on('session.end', async ($, e, next) => {
    cancelarTimers()
    if (e.reason === 'clear') {
      // Passagem DESTA sessao (arquivo com o id dela) gravada depois do pedido: so decide o toast. Quem entrega e o
      // gancho SessionStart do nucleo na sessao nova (ele renomeia o arquivo; por isso a conferencia vem antes do next).
      const [{ arq, id: antes }, agora, f, eraInterativa] = await Promise.all([contexto($), $.clock.now(), read($, fase), read($, interativo)])
      // O estado da sessao nova nasce vazio: o modulo leva o interativo desta (um hot reload o deixara em false).
      interativoModulo ||= eraInterativa
      const veioDaPassagem =
        arq !== '' &&
        (f === 'escrevendo' || f === 'pronta') &&
        (await $.fs.exists(arq)) && (await $.fs.stat(arq)).mtimeMs >= Math.max(pedidoEm - 1000, agora - VALIDADE_MS)
      const pedido = pedidoEm
      const r = await next(e)
      // O id pode ou nao mudar no /clear: apaga o piso do antigo e do atual, a sessao nova mede do zero.
      const novo = await $.session.id().catch(() => e.sessionId)
      await esquecerPiso($, [e.sessionId, antes, novo])
      rastro(
        $,
        `session.end reason=${e.reason} evento=${e.sessionId} antes=${antes} depois=${novo} fase=${f} pedidoEm=${pedido} veio=${veioDaPassagem} budgetRestanteMs=${next.budget.remainingMs}`,
      )
      pedidoEm = 0
      await ocioso($, undefined, 'session.end clear')
      await update($, tokens, () => null)
      await update($, piso, () => null)
      await update($, adiado, () => null)
      recarregar($, antes)
      if (veioDaPassagem) $.ui.toast(tx('opened'))
      return r
    }
    rastro($, `session.end reason=${e.reason} evento=${e.sessionId}`)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const [n, pi, a, f, ligado, falta, lento, lim, visto, botaoVisivel, pronto] = await Promise.all([
      read($, tokens),
      read($, piso),
      read($, adiado),
      read($, fase),
      read($, auto),
      read($, restante),
      read($, demorou),
      read($, limiar),
      read($, apresentado),
      read($, botaoFixo),
      read($, carregado),
    ])
    // Estado da sessao ainda nos padroes (logo depois do /clear): sem apresentacao nem botao a partir de valor errado.
    if (e.props.hasSurvey || !pronto) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    if (f === 'pronta') return <Text color="yellow">{tx('ready')}</Text>
    if (lento && (f === 'aguardando' || f === 'escrevendo')) {
      const v = await vivos($)
      return (
        <Box flexDirection="column">
          <Text color="yellow">{tx('waitingFor', v, v === 1 ? tx('agentOne') : tx('agentMany'))}</Text>
          <Box>
            <Button key="forcar" label={tx('forceSwitch')} onPress={() => forcar($)} />
            <Text> </Text>
            <Button key="cancelar" label={tx('cancel')} onPress={async () => ocioso($, automatica ? await read($, tokens) : undefined, 'cancelou a espera')} />
          </Box>
        </Box>
      )
    }
    if (f === 'escrevendo') return <Text dimColor>{tx('writing')}</Text>
    if (f === 'contando' && contagem !== null) {
      return (
        <Box flexDirection="column">
          <Text color="yellow">{tx('counting', falta)}</Text>
          <Box>
            <Button key="agora" label={tx('now')} onPress={() => agora($)} />
            <Text> </Text>
            <Button key="cancelar" label={tx('cancel')} onPress={() => cancelarContagem($)} />
          </Box>
        </Box>
      )
    }
    if (f === 'aguardando') {
      const v = await vivos($)
      return (
        <Box flexDirection="column">
          <Text dimColor>{tx('waitingToWrite', v, v === 1 ? tx('agentOneFinish') : tx('agentManyFinish'))}</Text>
          <Box>
            <Button
              key="cancelar"
              label={tx('cancel')}
              onPress={async () => ocioso($, automatica ? await read($, tokens) : undefined, 'cancelou a espera')}
            />
          </Box>
        </Box>
      )
    }
    if (n === null || pi === null || !deveAvisar(n, pi, a, f, lim)) {
      if (!visto) {
        const resto = await next(e)
        return (
          <Box flexDirection="column">
            <Text color="cyan">{tx('intro', Math.round(lim / 1000))}</Text>
            <Text>{ligado ? tx('introAutoOn', CONTAGEM_S) : tx('introAutoOff', CONTAGEM_S)}</Text>
            <Text>{tx('introHow')}</Text>
            <Box>
              <Button key="entendi" label={tx('gotIt')} onPress={() => void apresentar($, false)} />
              <Text> </Text>
              <Button key="alternar" label={ligado ? tx('turnAutoOff') : tx('turnAutoOn')} onPress={() => void apresentar($, true)} />
            </Box>
            {resto}
          </Box>
        )
      }
      // Sem faixa: so o interruptor do auto, sempre visivel. O que vier depois na cadeia (next) segue na mesma linha.
      const resto = await next(e)
      if (!botaoVisivel) return resto
      return (
        <Box>
          <Button key="auto" label={ligado ? tx('autoButtonOn') : tx('autoButtonOff')} onPress={() => void alternarAuto($, 'botao')} />
          {resto}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text color="yellow">{tx('banner', Math.round(n / 1000), Math.round((n - pi) / 1000))}</Text>
        <Box>
          <Button key="trocar" label={tx('switchSession')} onPress={() => trocar($)} />
          <Text> </Text>
          <Button key="depois" label={tx('later')} onPress={() => update($, adiado, () => n)} />
          <Text> </Text>
          <Button key="auto" label={ligado ? tx('autoButtonOn') : tx('autoButtonOff')} onPress={() => void alternarAuto($, 'botao')} />
        </Box>
      </Box>
    )
  })
}
