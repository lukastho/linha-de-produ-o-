import { useState, useEffect, useCallback } from "react";
import {
  api, carregarRegistros, carregarPadrao, aplicarPadraoATodos, reordenarPadrao,
  contarPadraoDoCaminhao, etapasDoCaminhao,
} from "../lib/api.js";
import Foto from "../componentes/Foto.jsx";

export default function Admin({ dados, recarregar, mostrar }) {
  const [aba, setAba] = useState("operadores");
  const [perfil, setPerfil] = useState(null);
  const [padrao, setPadrao] = useState(null);

  const recarregarPadrao = useCallback(async () => {
    try {
      setPadrao(await carregarPadrao());
    } catch (e) {
      mostrar(e.message);
      setPadrao([]);
    }
  }, [mostrar]);

  useEffect(() => { recarregarPadrao(); }, [recarregarPadrao]);

  // recarrega catálogo e padrão juntos, para as contagens não ficarem velhas
  const recarregarTudo = useCallback(async () => {
    await Promise.all([recarregar(), recarregarPadrao()]);
  }, [recarregar, recarregarPadrao]);

  const abas = [
    ["operadores", "Operadores"], ["cargos", "Cargos"], ["modelos", "Modelos"],
    ["coletores", "Coletores"], ["linha", "Padrão de fábrica"],
  ];

  const ctx = { dados, padrao, recarregar: recarregarTudo, mostrar };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-medium">Painel de gestão</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Estas alterações vão direto ao banco. Operadores só conseguem marcar tarefas do próprio cargo.
      </p>

      {padrao && padrao.length === 0 && (
        <div className="mt-4 rounded-lg border-2 border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          O padrão de fábrica está vazio. Rode a migração <strong>002_padrao_de_fabrica.sql</strong> no
          SQL Editor do Supabase antes de cadastrar coletores.
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2 border-b-2 border-zinc-300">
        {abas.map(([id, rotulo]) => (
          <button key={id} onClick={() => setAba(id)}
            className={"px-4 py-3 text-sm sm:px-5 " + (aba === id ? "border-b-4 border-emerald-600 font-medium" : "text-zinc-500")}>
            {rotulo}
          </button>
        ))}
      </div>

      <div className="py-6">
        {aba === "operadores" && <Operadores {...ctx} abrirPerfil={setPerfil} />}
        {aba === "cargos" && <Cargos {...ctx} />}
        {aba === "modelos" && <Modelos {...ctx} />}
        {aba === "coletores" && <Coletores {...ctx} />}
        {aba === "linha" && <Linha {...ctx} />}
      </div>

      {perfil && <Perfil operador={perfil} fechar={() => setPerfil(null)} dados={dados} />}
    </div>
  );
}

// --- utilidades de UI ------------------------------------------------

const Campo = (p) => (
  <input {...p} className={"rounded-lg border-2 border-zinc-300 px-3 py-3 outline-none " + (p.className ?? "")} />
);

const Botao = ({ children, ...p }) => (
  <button {...p} className={"rounded-lg bg-emerald-600 px-5 py-3 font-medium text-white disabled:bg-zinc-300 " + (p.className ?? "")}>
    {children}
  </button>
);

function useAcao(recarregar, mostrar) {
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const rodar = async (fn, msg) => {
    setOcupado(true);
    setErro("");
    try {
      await fn();
      await recarregar();
      if (msg) mostrar(msg);
      return true;
    } catch (e) {
      setErro(e.message);
      return false;
    } finally {
      setOcupado(false);
    }
  };
  return { erro, setErro, ocupado, rodar };
}

const Erro = ({ children }) => children ? <p className="mt-3 text-sm text-red-700">{children}</p> : null;

// --- Operadores ------------------------------------------------------

function Operadores({ dados, recarregar, mostrar, abrirPerfil }) {
  const [f, setF] = useState({ nome: "", matricula: "", cargo_id: dados.cargos[0]?.id ?? "" });
  const { erro, setErro, ocupado, rodar } = useAcao(recarregar, mostrar);

  const cargoDe = (id) => dados.cargos.find((c) => c.id === id)?.nome ?? "sem cargo";
  const sessaoDe = (m) => dados.sessoes.find((s) => s.matricula === m);

  async function adicionar() {
    if (!f.nome.trim() || !f.matricula.trim()) return setErro("Nome e matrícula são obrigatórios.");
    if (!f.cargo_id) return setErro("Cadastre um cargo antes.");
    const ok = await rodar(() => api.usuarios.criar({ ...f, e_admin: false }), "Operador cadastrado");
    if (ok) setF({ nome: "", matricula: "", cargo_id: dados.cargos[0]?.id ?? "" });
  }

  return (
    <div>
      <div className="rounded-lg border-2 border-zinc-300 bg-white p-4">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500">Cadastrar operador</h2>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Campo value={f.matricula} onChange={(e) => setF({ ...f, matricula: e.target.value })}
            placeholder="Matrícula" className="font-mono" />
          <Campo value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Nome completo" />
          <select value={f.cargo_id} onChange={(e) => setF({ ...f, cargo_id: e.target.value })}
            className="rounded-lg border-2 border-zinc-300 px-3 py-3 outline-none">
            {dados.cargos.length === 0 && <option value="">Nenhum cargo cadastrado</option>}
            {dados.cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <Erro>{erro}</Erro>
        <Botao onClick={adicionar} disabled={ocupado} className="mt-3">Cadastrar operador</Botao>
      </div>

      <div className="mt-5">
        {dados.usuarios.filter((u) => !u.e_admin).map((u) => {
          const s = sessaoDe(u.matricula);
          return (
            <div key={u.id} className="mb-2 flex items-center gap-4 rounded-lg border-2 border-zinc-300 bg-white px-4 py-3">
              <span className="w-20 font-mono text-lg">{u.matricula}</span>
              <div className="flex-1">
                <div>{u.nome}</div>
                {s ? (
                  <span className="flex items-center gap-2 text-xs text-emerald-800">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    na linha agora · chassi {s.chassi}
                  </span>
                ) : (
                  <span className="text-xs text-zinc-400">fora da linha</span>
                )}
              </div>
              <select value={u.cargo_id ?? ""} disabled={ocupado}
                onChange={(e) => rodar(() => api.usuarios.atualizar(u.id, { cargo_id: e.target.value }), "Cargo alterado")}
                className="rounded-lg border-2 border-zinc-300 px-3 py-2 text-sm">
                {dados.cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              <button onClick={() => abrirPerfil(u)} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-zinc-50">
                Ver perfil
              </button>
              <button onClick={() => rodar(() => api.usuarios.atualizar(u.id, { ativo: false }), "Operador desativado")}
                className="rounded border border-zinc-300 px-3 py-2 text-sm text-red-700">Desativar</button>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        Operadores são desativados, não apagados: o histórico de quem fez cada tarefa precisa continuar de pé.
      </p>
    </div>
  );
}

// --- Perfil do operador ----------------------------------------------

function Perfil({ operador, fechar, dados }) {
  const [regs, setRegs] = useState(null);
  const sessao = dados.sessoes.find((s) => s.matricula === operador.matricula);
  const caminhao = sessao ? dados.caminhoes.find((c) => c.chassi === sessao.chassi) : null;
  const modelo = caminhao ? dados.modelos.find((m) => m.id === caminhao.modelo_id) : null;
  const etapa = caminhao ? dados.etapas.find((e) => e.id === caminhao.etapa_atual_id) : null;

  useEffect(() => {
    carregarRegistros()
      .then((r) => setRegs(r.filter((x) => x.usuario_id === operador.id)))
      .catch(() => setRegs([]));
  }, [operador.id]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black bg-opacity-50 px-4 py-8" onClick={fechar}>
      <div className="mx-auto max-w-2xl rounded-lg bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-sm text-zinc-500">{operador.matricula}</div>
            <h2 className="text-2xl font-medium">{operador.nome}</h2>
            <p className="text-sm text-zinc-600">
              {dados.cargos.find((c) => c.id === operador.cargo_id)?.nome ?? "sem cargo"}
            </p>
          </div>
          <button onClick={fechar} className="rounded border border-zinc-300 px-3 py-2 text-sm">Fechar</button>
        </div>

        <div className="mt-5">
          {sessao ? (
            <div className="flex flex-wrap items-center gap-4 rounded-lg border-2 border-emerald-600 bg-emerald-50 px-4 py-3">
              <Foto src={modelo?.imagem_url} alt={modelo?.nome ?? ""} className="h-16 w-24 rounded" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="text-xs uppercase tracking-widest text-emerald-800">Na linha agora</span>
                </div>
                <div className="mt-1 text-sm">{modelo?.nome} · <span className="font-mono">{sessao.chassi}</span></div>
                <div className="text-sm text-zinc-600">Etapa atual do coletor: {etapa?.nome ?? "não definida"}</div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border-2 border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-600">
              Fora da linha no momento.
            </div>
          )}
        </div>

        <h3 className="mt-5 text-xs uppercase tracking-widest text-zinc-500">Histórico</h3>
        {regs === null && <p className="mt-2 text-sm text-zinc-500">Carregando…</p>}
        {regs?.length === 0 && (
          <p className="mt-2 rounded-lg border-2 border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500">
            Nenhuma marcação registrada.
          </p>
        )}
        {regs?.slice(0, 20).map((r) => {
          const c = dados.caminhoes.find((x) => x.id === r.caminhao_id);
          return (
            <div key={r.id} className="mt-2 flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2">
              <span className={"rounded px-2 py-1 text-xs uppercase tracking-widest " +
                (r.tipo === "conclusao" ? "bg-emerald-600 text-white"
                  : r.tipo === "inicio" ? "bg-zinc-900 text-zinc-50" : "bg-zinc-200 text-zinc-600")}>
                {r.tipo === "conclusao" ? "OK" : r.tipo === "inicio" ? "Início" : "Reabriu"}
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <div>{r.tarefas?.descricao ?? "tarefa removida"}</div>
                <div className="text-xs text-zinc-500">
                  {r.tarefas?.etapas?.nome}{r.tarefas?.grupo ? ` · ${r.tarefas.grupo}` : ""} · <span className="font-mono">{c?.chassi}</span>
                </div>
              </div>
              <span className="text-xs text-zinc-500">
                {new Date(r.data_conclusao).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Cargos ----------------------------------------------------------

function Cargos({ dados, padrao, recarregar, mostrar }) {
  const [nome, setNome] = useState("");
  const { erro, setErro, ocupado, rodar } = useAcao(recarregar, mostrar);

  const uso = (id) => ({
    operadores: dados.usuarios.filter((u) => u.cargo_id === id && !u.e_admin && u.ativo).length,
    tarefas: (padrao ?? []).reduce((n, e) => n + e.tarefas.filter((t) => t.cargo_responsavel_id === id).length, 0),
  });

  async function adicionar() {
    if (!nome.trim()) return setErro("Digite o nome do cargo.");
    const ok = await rodar(() => api.cargos.criar({ nome: nome.trim() }), "Cargo criado");
    if (ok) setNome("");
  }

  return (
    <div className="max-w-3xl">
      <div className="rounded-lg border-2 border-zinc-300 bg-white p-4">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500">Novo cargo</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <Campo value={nome} onChange={(e) => setNome(e.target.value)} className="min-w-0 flex-1"
            placeholder="Ex.: Caldeireiro, Tapeceiro" />
          <Botao onClick={adicionar} disabled={ocupado}>Adicionar</Botao>
        </div>
        <Erro>{erro}</Erro>
      </div>

      <div className="mt-5">
        {dados.cargos.map((c) => {
          const u = uso(c.id);
          const semGente = u.operadores === 0 && u.tarefas > 0;
          return (
            <div key={c.id} className={"mb-2 flex flex-wrap items-center gap-3 rounded-lg border-2 bg-white px-4 py-3 " +
              (semGente ? "border-red-300" : "border-zinc-300")}>
              <input defaultValue={c.nome} disabled={ocupado}
                onBlur={(e) => e.target.value !== c.nome && rodar(() => api.cargos.atualizar(c.id, { nome: e.target.value }), "Cargo renomeado")}
                className="min-w-0 flex-1 bg-transparent py-1 text-lg outline-none" />
              <span className="text-xs text-zinc-500">{u.operadores} operador(es) · {u.tarefas} tarefa(s) no padrão</span>
              {semGente && <span className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">tem tarefa, não tem gente</span>}
              <button disabled={ocupado}
                onClick={() => {
                  if (u.operadores || u.tarefas) return mostrar("Cargo em uso. Reatribua antes de excluir.");
                  rodar(() => api.cargos.excluir(c.id), "Cargo excluído");
                }}
                className="rounded border border-zinc-300 px-3 py-2 text-sm text-red-700">Excluir</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Modelos ---------------------------------------------------------

const TIPOS = [["coletor", "Coletor compactador"], ["pipa", "Tanque pipa"]];
const nomeTipo = (t) => TIPOS.find(([id]) => id === t)?.[1] ?? "Coletor compactador";

function Modelos({ dados, recarregar, mostrar }) {
  const vazio = { nome: "", capacidade: "", descricao: "", imagem_url: "", tipo_equipamento: "coletor" };
  const [f, setF] = useState(vazio);
  const { erro, setErro, ocupado, rodar } = useAcao(recarregar, mostrar);

  async function adicionar() {
    if (!f.nome.trim()) return setErro("Dê um nome ao modelo.");
    const ok = await rodar(() => api.modelos.criar(f), "Modelo cadastrado");
    if (ok) setF(vazio);
  }

  return (
    <div>
      <div className="rounded-lg border-2 border-zinc-300 bg-white p-4">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500">Novo modelo</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Nome (ex.: Coletor CSC-LL)" />
          <select value={f.tipo_equipamento} onChange={(e) => setF({ ...f, tipo_equipamento: e.target.value })}
            className="rounded-lg border-2 border-zinc-300 px-3 py-3 outline-none">
            {TIPOS.map(([id, rot]) => <option key={id} value={id}>{rot}</option>)}
          </select>
          <Campo value={f.capacidade} onChange={(e) => setF({ ...f, capacidade: e.target.value })} placeholder="Capacidade (ex.: 5 a 19 m³)" />
          <Campo value={f.imagem_url} onChange={(e) => setF({ ...f, imagem_url: e.target.value })} placeholder="URL da imagem" />
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          O tipo define qual padrão de fábrica os coletores deste modelo recebem.
        </p>
        <Erro>{erro}</Erro>
        <Botao onClick={adicionar} disabled={ocupado} className="mt-3">Cadastrar modelo</Botao>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {dados.modelos.map((m) => (
          <div key={m.id} className="overflow-hidden rounded-lg border-2 border-zinc-300 bg-white">
            <Foto src={m.imagem_url} alt={m.nome} className="h-36 w-full" />
            <div className="px-4 py-3">
              <input defaultValue={m.nome} disabled={ocupado}
                onBlur={(e) => e.target.value !== m.nome && rodar(() => api.modelos.atualizar(m.id, { nome: e.target.value }))}
                className="w-full bg-transparent text-base font-medium outline-none" />
              <select value={m.tipo_equipamento ?? "coletor"} disabled={ocupado}
                onChange={(e) => rodar(() => api.modelos.atualizar(m.id, { tipo_equipamento: e.target.value }), "Tipo alterado — vale para coletores novos")}
                className="mt-2 rounded border border-zinc-300 px-2 py-1 text-xs">
                {TIPOS.map(([id, rot]) => <option key={id} value={id}>{rot}</option>)}
              </select>
              <input defaultValue={m.imagem_url ?? ""} disabled={ocupado} placeholder="URL da imagem"
                onBlur={(e) => e.target.value !== (m.imagem_url ?? "") && rodar(() => api.modelos.atualizar(m.id, { imagem_url: e.target.value }))}
                className="mt-2 w-full rounded border border-zinc-200 px-2 py-1 text-xs outline-none" />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-zinc-500">
                  {dados.caminhoes.filter((c) => c.modelo_id === m.id).length} coletor(es) na linha
                </span>
                <button onClick={() => rodar(() => api.modelos.excluir(m.id), "Modelo excluído")}
                  className="text-sm text-red-700">Excluir</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Coletores -------------------------------------------------------

function Coletores({ dados, padrao, recarregar, mostrar }) {
  const vazio = { chassi: "", os: "", modelo_id: dados.modelos[0]?.id ?? "", cliente: "" };
  const [f, setF] = useState(vazio);
  const [criando, setCriando] = useState(false);
  const { erro, setErro, ocupado, rodar } = useAcao(recarregar, mostrar);

  async function adicionar() {
    if (!f.chassi.trim()) return setErro("O chassi é obrigatório.");
    setErro("");
    setCriando(true);
    try {
      // O banco copia o padrão de fábrica no mesmo instante do cadastro
      // (trigger). Quando o insert volta, etapas e tarefas já existem.
      const novo = await api.caminhoes.criar({ ...f, chassi: f.chassi.trim() });
      const qtd = await contarPadraoDoCaminhao(novo.id);
      await recarregar();
      setF(vazio);
      if (qtd.tarefas === 0) {
        mostrar(`Coletor ${novo.chassi} cadastrado, mas SEM padrão. Confira o padrão de fábrica.`);
      } else {
        mostrar(`Coletor ${novo.chassi} cadastrado com ${qtd.etapas} etapas e ${qtd.tarefas} tarefas do padrão`);
      }
    } catch (e) {
      setErro(e.message);
    } finally {
      setCriando(false);
    }
  }

  function remover(c) {
    const ok = window.confirm(
      `Remover o coletor ${c.chassi}? As etapas e tarefas dele serão apagadas junto. ` +
      `Se alguém já marcou tarefa nele, o sistema vai recusar para proteger o histórico.`);
    if (ok) rodar(() => api.caminhoes.excluir(c.id), "Coletor removido");
  }

  const modeloSel = dados.modelos.find((m) => m.id === f.modelo_id);
  const tipoSel = modeloSel?.tipo_equipamento ?? "coletor";
  const padraoSel = (padrao ?? []).filter((e) => e.tipo_equipamento === tipoSel);
  const tarefasSel = padraoSel.reduce((n, e) => n + e.tarefas.length, 0);

  return (
    <div>
      <div className="rounded-lg border-2 border-zinc-300 bg-white p-4">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500">Cadastrar coletor na linha</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo value={f.chassi} onChange={(e) => setF({ ...f, chassi: e.target.value.toUpperCase() })}
            placeholder="Chassi" className="font-mono" />
          <Campo value={f.os} onChange={(e) => setF({ ...f, os: e.target.value })} placeholder="OF / OS" className="font-mono" />
          <select value={f.modelo_id} onChange={(e) => setF({ ...f, modelo_id: e.target.value })}
            className="rounded-lg border-2 border-zinc-300 px-3 py-3 outline-none">
            {dados.modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
          <Campo value={f.cliente} onChange={(e) => setF({ ...f, cliente: e.target.value })} placeholder="Cliente" />
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Recebe automaticamente o padrão de {nomeTipo(tipoSel).toLowerCase()}: {padraoSel.length} etapas, {tarefasSel} tarefas obrigatórias.
        </p>
        <Erro>{erro}</Erro>
        <Botao onClick={adicionar} disabled={criando || ocupado} className="mt-3">
          {criando ? "Cadastrando e gerando checklist…" : "Cadastrar coletor"}
        </Botao>
      </div>

      <div className="mt-5">
        {dados.caminhoes.map((c) => {
          const m = dados.modelos.find((x) => x.id === c.modelo_id);
          const equipe = dados.sessoes.filter((s) => s.chassi === c.chassi);
          const etapasC = etapasDoCaminhao(dados.etapas, c.id);
          return (
            <div key={c.id} className="mb-2 rounded-lg border-2 border-zinc-300 bg-white px-4 py-3">
              <div className="flex flex-wrap items-center gap-4">
                <Foto src={m?.imagem_url} alt={m?.nome ?? c.chassi} className="h-16 w-24 rounded" />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-lg">{c.chassi}</div>
                  <div className="text-sm">{m?.nome ?? "sem modelo"}</div>
                  <div className="text-xs text-zinc-500">{c.cliente || "sem cliente"} · OF {c.os || "—"}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-zinc-500">Etapa atual</label>
                  <select value={c.etapa_atual_id ?? ""} disabled={ocupado}
                    onChange={(e) => rodar(() => api.caminhoes.atualizar(c.id, { etapa_atual_id: e.target.value || null }), "Etapa alterada")}
                    className="rounded-lg border-2 border-zinc-300 px-3 py-2 text-sm">
                    <option value="">Sem etapa</option>
                    {etapasC.map((e) => <option key={e.id} value={e.id}>{e.nome}{e.caminhao_id ? "" : " (antiga)"}</option>)}
                  </select>
                  <button onClick={() => remover(c)}
                    className="rounded border border-zinc-300 px-3 py-2 text-sm text-red-700">Remover</button>
                </div>
              </div>
              {equipe.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs uppercase tracking-widest text-emerald-800">Na linha agora</span>
                  {equipe.map((s) => (
                    <span key={s.id} className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">{s.nome}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Padrão de fábrica (template) ------------------------------------

const Cadeado = () => (
  <span className="rounded bg-zinc-900 px-2 py-1 text-xs uppercase tracking-widest text-zinc-50">
    Padrão de fábrica
  </span>
);

function Linha({ dados, padrao, recarregar, mostrar }) {
  const [tipo, setTipo] = useState("coletor");
  const [abertaId, setAbertaId] = useState(null);
  const [nEtapa, setNEtapa] = useState({ nome: "", cargo_responsavel_id: dados.cargos[0]?.id ?? "" });
  const [nTarefa, setNTarefa] = useState({ descricao: "", grupo: "", cargo_responsavel_id: "" });
  const [resultado, setResultado] = useState(null);
  const { erro, setErro, ocupado, rodar } = useAcao(recarregar, mostrar);

  const etapas = (padrao ?? []).filter((e) => e.tipo_equipamento === tipo);
  const etapa = etapas.find((e) => e.id === abertaId) ?? etapas[0] ?? null;
  const antigas = dados.etapas.filter((e) => !e.caminhao_id);

  function abrirEtapa(id) {
    setAbertaId(id);
    if (window.innerWidth < 1024) {
      setTimeout(() => document.getElementById("painel-tarefas")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  }

  async function addEtapa() {
    if (!nEtapa.nome.trim()) return setErro("Dê um nome à etapa.");
    let criada = null;
    const ok = await rodar(async () => {
      criada = await api.etapasPadrao.criar({
        nome: nEtapa.nome.trim(),
        tipo_equipamento: tipo,
        cargo_responsavel_id: nEtapa.cargo_responsavel_id || null,
        ordem: Math.max(0, ...etapas.map((e) => e.ordem)) + 10,
      });
    }, "Etapa criada no padrão");
    if (ok) {
      setNEtapa({ nome: "", cargo_responsavel_id: dados.cargos[0]?.id ?? "" });
      if (criada?.id) abrirEtapa(criada.id);
    }
  }

  async function addTarefa() {
    if (!nTarefa.descricao.trim()) return setErro("Descreva a tarefa.");
    const cargo = nTarefa.cargo_responsavel_id || etapa.cargo_responsavel_id;
    if (!cargo) return setErro("Defina o cargo responsável pela tarefa.");
    const grupo = nTarefa.grupo.trim() || null;
    const ok = await rodar(async () => {
      const criada = await api.tarefasPadrao.criar({
        etapa_padrao_id: etapa.id,
        descricao: nTarefa.descricao.trim(),
        grupo,
        cargo_responsavel_id: cargo,
        ordem: Math.max(0, ...etapa.tarefas.map((t) => t.ordem)) + 1,
      });
      // encaixa logo depois da última tarefa da mesma seção, em vez de ir para o fim
      const ids = etapa.tarefas.map((t) => t.id);
      let pos = -1;
      etapa.tarefas.forEach((t, i) => { if (grupo && t.grupo === grupo) pos = i; });
      if (pos >= 0 && pos < ids.length - 1) {
        ids.splice(pos + 1, 0, criada.id);
        await reordenarPadrao("tarefas", ids);
      }
    }, "Tarefa criada no padrão");
    if (ok) setNTarefa({ descricao: "", grupo: nTarefa.grupo, cargo_responsavel_id: "" });
  }

  function moverEtapa(i, d) {
    const j = i + d;
    if (j < 0 || j >= etapas.length) return;
    const ids = etapas.map((e) => e.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    rodar(() => reordenarPadrao("etapas", ids), "Ordem atualizada");
  }

  // só troca de lugar dentro da mesma seção, para não embaralhar os grupos
  function moverTarefa(i, d) {
    const lista = etapa.tarefas;
    const j = i + d;
    if (j < 0 || j >= lista.length || (lista[i].grupo ?? "") !== (lista[j].grupo ?? "")) return;
    const ids = lista.map((t) => t.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    rodar(() => reordenarPadrao("tarefas", ids), "Ordem atualizada");
  }

  async function desativarAntiga(e) {
    const ok = window.confirm(
      `Desativar "${e.nome}"?\n\n` +
      "Ela some da tela de todos os coletores. As marcações feitas nela continuam " +
      "guardadas no histórico. Dá para reativar depois pelo banco.");
    if (!ok) return;
    await rodar(async () => {
      await api.etapas.atualizar(e.id, { ativo: false });
      // coletor que estava nessa etapa passa para a primeira etapa dele,
      // em vez de ficar apontando para uma etapa invisível
      for (const c of dados.caminhoes.filter((x) => x.etapa_atual_id === e.id)) {
        const primeira = dados.etapas
          .filter((x) => x.caminhao_id === c.id)
          .sort((a, b) => a.ordem - b.ordem)[0];
        await api.caminhoes.atualizar(c.id, { etapa_atual_id: primeira?.id ?? null });
      }
    }, `"${e.nome}" desativada`);
  }

  async function aplicarATodos() {
    const ok = window.confirm(
      "Aplicar o padrão aos coletores já cadastrados?\n\n" +
      "Só ACRESCENTA as etapas e tarefas que estiverem faltando. " +
      "Não apaga nada e não mexe em nenhuma marcação já feita.");
    if (!ok) return;
    await rodar(async () => {
      const r = await aplicarPadraoATodos();
      setResultado(r);
    });
  }

  const gruposDaEtapa = etapa ? [...new Set(etapa.tarefas.map((t) => t.grupo).filter(Boolean))] : [];

  if (padrao === null) return <p className="text-sm text-zinc-500">Carregando padrão de fábrica…</p>;

  return (
    <div>
      <div className="rounded-lg border-2 border-zinc-300 bg-white p-4 text-sm text-zinc-700">
        <p>
          Este é o checklist oficial. Todo coletor cadastrado recebe uma <strong>cópia</strong> dele automaticamente.
          Os itens marcados como <strong>padrão de fábrica</strong> não podem ser excluídos.
        </p>
        <p className="mt-2">
          Mudanças aqui valem para os coletores <strong>novos</strong>. Para levar itens novos aos que já existem,
          use o botão abaixo: ele só acrescenta o que falta, sem apagar nada nem mexer em marcações.
        </p>
        <button onClick={aplicarATodos} disabled={ocupado}
          className="mt-3 rounded-lg border-2 border-zinc-900 bg-white px-4 py-2 font-medium">
          Aplicar padrão aos coletores existentes
        </button>
        {resultado && (
          <div className="mt-3 rounded bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            {resultado.reduce((n, r) => n + r.tarefas_adicionadas, 0) === 0
              ? `Todos os ${resultado.length} coletores já estavam com o padrão completo.`
              : resultado.filter((r) => r.tarefas_adicionadas > 0)
                  .map((r) => `${r.chassi}: +${r.tarefas_adicionadas} tarefa(s)`).join(" · ")}
          </div>
        )}
      </div>

      <div className="mt-5 flex gap-2">
        {TIPOS.map(([id, rot]) => (
          <button key={id} onClick={() => { setTipo(id); setAbertaId(null); }}
            className={"rounded px-4 py-2 text-sm " + (tipo === id ? "bg-zinc-900 text-zinc-50" : "border border-zinc-300 bg-white text-zinc-600")}>
            {rot}
          </button>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-6">
        <div className="min-w-0">
          <h2 className="text-xs uppercase tracking-widest text-zinc-500">Etapas</h2>
          <div className="mt-3">
            {etapas.length === 0 && (
              <p className="rounded-lg border-2 border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500">
                Nenhuma etapa no padrão deste tipo.
              </p>
            )}
            {etapas.map((e, i) => (
              <div key={e.id} className={"mb-2 rounded-lg border-2 bg-white px-3 py-2 " +
                (e.id === etapa?.id ? "border-emerald-600" : "border-zinc-300")}>
                <div className="flex flex-wrap items-center gap-2">
                  <input defaultValue={e.nome} disabled={ocupado}
                    onBlur={(ev) => ev.target.value !== e.nome && rodar(() => api.etapasPadrao.atualizar(e.id, { nome: ev.target.value }))}
                    className="min-w-0 flex-1 bg-transparent py-1 outline-none" />
                  <div className="flex items-center gap-1">
                    <button onClick={() => moverEtapa(i, -1)} className="px-2 py-1 text-zinc-500">↑</button>
                    <button onClick={() => moverEtapa(i, 1)} className="px-2 py-1 text-zinc-500">↓</button>
                    <button onClick={() => abrirEtapa(e.id)} className="rounded border border-zinc-300 px-3 py-1 text-sm">
                      {e.tarefas.length} tarefas
                    </button>
                    {!e.bloqueada && (
                      <button onClick={() => rodar(() => api.etapasPadrao.excluir(e.id), "Etapa excluída do padrão")}
                        className="px-2 py-1 text-red-600">×</button>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {e.bloqueada && <Cadeado />}
                  <span className="text-xs text-zinc-500">Cargo</span>
                  <select value={e.cargo_responsavel_id ?? ""} disabled={ocupado}
                    onChange={(ev) => rodar(() => api.etapasPadrao.atualizar(e.id, { cargo_responsavel_id: ev.target.value || null }))}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs">
                    {dados.cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Campo value={nEtapa.nome} onChange={(e) => setNEtapa({ ...nEtapa, nome: e.target.value })}
              placeholder="Nova etapa do padrão" className="w-full py-2 sm:w-auto sm:flex-1" />
            <select value={nEtapa.cargo_responsavel_id} onChange={(e) => setNEtapa({ ...nEtapa, cargo_responsavel_id: e.target.value })}
              className="min-w-0 flex-1 rounded-lg border-2 border-zinc-300 px-2 py-2 text-sm sm:flex-none">
              {dados.cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            <Botao onClick={addEtapa} disabled={ocupado} className="px-4 py-2">Adicionar</Botao>
          </div>
          <Erro>{erro}</Erro>

          {antigas.length > 0 && (
            <div className="mt-8">
              <h2 className="text-xs uppercase tracking-widest text-zinc-500">Etapas antigas (anteriores ao padrão)</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Aparecem em todos os coletores. Desativar esconde a etapa sem apagar as marcações já feitas nela.
              </p>
              {antigas.map((e) => (
                <div key={e.id} className="mt-2 flex items-center gap-3 rounded-lg border-2 border-zinc-200 bg-zinc-50 px-3 py-2">
                  <span className="min-w-0 flex-1 text-sm">{e.nome}</span>
                  <button onClick={() => desativarAntiga(e)}
                    disabled={ocupado} className="rounded border border-zinc-300 px-3 py-1 text-sm">Desativar</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div id="painel-tarefas" className="min-w-0 scroll-mt-4">
          <h2 className="text-xs uppercase tracking-widest text-zinc-500">
            Tarefas — {etapa?.nome ?? "selecione uma etapa"}
          </h2>
          {etapa && (
            <>
              <div className="mt-3">
                {etapa.tarefas.length === 0 && (
                  <p className="rounded-lg border-2 border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500">
                    Nenhuma tarefa nesta etapa. Adicione a primeira abaixo.
                  </p>
                )}
                {etapa.tarefas.map((t, i) => {
                  const novoGrupo = i === 0 || (etapa.tarefas[i - 1].grupo ?? "") !== (t.grupo ?? "");
                  return (
                    <div key={t.id}>
                      {novoGrupo && t.grupo && (
                        <h3 className="mb-2 mt-4 text-xs uppercase tracking-widest text-zinc-500">{t.grupo}</h3>
                      )}
                      <div className="mb-2 rounded-lg border-2 border-zinc-300 bg-white px-3 py-2">
                        <div className="flex items-center gap-2">
                          <input defaultValue={t.descricao} disabled={ocupado}
                            onBlur={(ev) => ev.target.value !== t.descricao && rodar(() => api.tarefasPadrao.atualizar(t.id, { descricao: ev.target.value }))}
                            className="min-w-0 flex-1 bg-transparent py-1 outline-none" />
                          <button onClick={() => moverTarefa(i, -1)} className="px-2 py-1 text-zinc-500">↑</button>
                          <button onClick={() => moverTarefa(i, 1)} className="px-2 py-1 text-zinc-500">↓</button>
                          {!t.bloqueada && (
                            <button onClick={() => rodar(() => api.tarefasPadrao.excluir(t.id), "Tarefa excluída do padrão")}
                              className="px-2 py-1 text-red-600">×</button>
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {t.bloqueada && <Cadeado />}
                          <select value={t.cargo_responsavel_id} disabled={ocupado}
                            onChange={(ev) => rodar(() => api.tarefasPadrao.atualizar(t.id, { cargo_responsavel_id: ev.target.value }))}
                            className="rounded border border-zinc-300 px-2 py-1 text-xs">
                            {dados.cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                          </select>
                          {t.bloqueada ? (
                            <span className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600">obrigatória</span>
                          ) : (
                            <button disabled={ocupado}
                              onClick={() => rodar(() => api.tarefasPadrao.atualizar(t.id, { obrigatoria: !t.obrigatoria }))}
                              className={"rounded px-2 py-1 text-xs " + (t.obrigatoria ? "bg-zinc-900 text-zinc-50" : "border border-zinc-300 text-zinc-500")}>
                              {t.obrigatoria ? "obrigatória" : "opcional"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 rounded-lg border-2 border-zinc-300 bg-white p-3">
                <Campo value={nTarefa.descricao} onChange={(e) => setNTarefa({ ...nTarefa, descricao: e.target.value })}
                  placeholder="Descrição da nova tarefa" className="w-full py-2" />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input list="grupos-da-etapa" value={nTarefa.grupo}
                    onChange={(e) => setNTarefa({ ...nTarefa, grupo: e.target.value })}
                    placeholder="Seção (opcional)"
                    className="min-w-0 flex-1 rounded-lg border-2 border-zinc-300 px-2 py-2 text-sm outline-none" />
                  <datalist id="grupos-da-etapa">
                    {gruposDaEtapa.map((g) => <option key={g} value={g} />)}
                  </datalist>
                  <select value={nTarefa.cargo_responsavel_id} onChange={(e) => setNTarefa({ ...nTarefa, cargo_responsavel_id: e.target.value })}
                    className="min-w-0 flex-1 rounded-lg border-2 border-zinc-300 px-2 py-2 text-sm">
                    <option value="">Cargo da etapa</option>
                    {dados.cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                  <Botao onClick={addTarefa} disabled={ocupado} className="px-4 py-2">Adicionar</Botao>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
