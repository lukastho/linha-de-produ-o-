import { useState } from "react";
import { api, reordenar, carregarRegistros } from "../lib/api.js";
import Foto from "../componentes/Foto.jsx";

export default function Admin({ dados, recarregar, mostrar }) {
  const [aba, setAba] = useState(dados.etapas.length === 0 ? "linha" : "operadores");
  const [perfil, setPerfil] = useState(null);

  const abas = [
    ["operadores", "Operadores"], ["cargos", "Cargos"], ["modelos", "Modelos"],
    ["coletores", "Coletores"], ["linha", "Linha de montagem"],
  ];

  const ctx = { dados, recarregar, mostrar };

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <h1 className="text-2xl font-medium">Painel de gestão</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Estas alterações vão direto ao banco. Operadores só conseguem marcar tarefas do próprio cargo.
      </p>

      {dados.etapas.length === 0 && (
        <div className="mt-4 rounded-lg border-2 border-emerald-600 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          A linha ainda não tem etapas. Comece pela aba <strong>Linha de montagem</strong>: crie as etapas
          na ordem da produção e, dentro de cada uma, as tarefas com o cargo responsável.
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2 border-b-2 border-zinc-300">
        {abas.map(([id, rotulo]) => (
          <button key={id} onClick={() => setAba(id)}
            className={"px-5 py-3 text-sm " + (aba === id ? "border-b-4 border-emerald-600 font-medium" : "text-zinc-500")}>
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

  if (regs === null) {
    carregarRegistros().then((r) => setRegs(r.filter((x) => x.usuario_id === operador.id))).catch(() => setRegs([]));
  }

  const achaTarefa = (id) => {
    for (const e of dados.etapas) {
      const t = e.tarefas.find((x) => x.id === id);
      if (t) return { t, e };
    }
    return { t: null, e: null };
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black bg-opacity-50 px-4 py-8" onClick={fechar}>
      <div className="mx-auto max-w-2xl rounded-lg bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
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
            <div className="flex items-center gap-4 rounded-lg border-2 border-emerald-600 bg-emerald-50 px-4 py-3">
              <Foto src={modelo?.imagem_url} alt={modelo?.nome ?? ""} className="h-16 w-24 rounded" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="text-xs uppercase tracking-widest text-emerald-800">Na linha agora</span>
                </div>
                <div className="mt-1 text-sm">{modelo?.nome} · <span className="font-mono">{sessao.chassi}</span></div>
                <div className="text-sm text-zinc-600">Área: {etapa?.nome ?? "sem etapa definida"}</div>
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
        {regs?.slice(0, 15).map((r) => {
          const { t, e } = achaTarefa(r.tarefa_id);
          const c = dados.caminhoes.find((x) => x.id === r.caminhao_id);
          return (
            <div key={r.id} className="mt-2 flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2">
              <span className={"rounded px-2 py-1 text-xs uppercase tracking-widest " +
                (r.tipo === "conclusao" ? "bg-emerald-600 text-white"
                  : r.tipo === "inicio" ? "bg-zinc-900 text-zinc-50" : "bg-zinc-200 text-zinc-600")}>
                {r.tipo === "conclusao" ? "OK" : r.tipo === "inicio" ? "Início" : "Reabriu"}
              </span>
              <div className="flex-1 text-sm">
                <div>{t?.descricao ?? "tarefa removida"}</div>
                <div className="text-xs text-zinc-500">{e?.nome} · <span className="font-mono">{c?.chassi}</span></div>
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

function Cargos({ dados, recarregar, mostrar }) {
  const [nome, setNome] = useState("");
  const { erro, setErro, ocupado, rodar } = useAcao(recarregar, mostrar);

  const uso = (id) => ({
    operadores: dados.usuarios.filter((u) => u.cargo_id === id).length,
    tarefas: dados.etapas.reduce((n, e) => n + e.tarefas.filter((t) => t.cargo_responsavel_id === id).length, 0),
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
        <div className="mt-3 flex gap-3">
          <Campo value={nome} onChange={(e) => setNome(e.target.value)} className="flex-1"
            placeholder="Ex.: Caldeireiro, Tapeceiro, Inspetor de qualidade" />
          <Botao onClick={adicionar} disabled={ocupado}>Adicionar</Botao>
        </div>
        <Erro>{erro}</Erro>
      </div>

      <div className="mt-5">
        {dados.cargos.map((c) => {
          const u = uso(c.id);
          const semGente = u.operadores === 0 && u.tarefas > 0;
          return (
            <div key={c.id} className={"mb-2 flex items-center gap-3 rounded-lg border-2 bg-white px-4 py-3 " +
              (semGente ? "border-red-300" : "border-zinc-300")}>
              <input defaultValue={c.nome} disabled={ocupado}
                onBlur={(e) => e.target.value !== c.nome && rodar(() => api.cargos.atualizar(c.id, { nome: e.target.value }), "Cargo renomeado")}
                className="flex-1 bg-transparent py-1 text-lg outline-none" />
              <span className="text-xs text-zinc-500">{u.operadores} operador(es) · {u.tarefas} tarefa(s)</span>
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

function Modelos({ dados, recarregar, mostrar }) {
  const [f, setF] = useState({ nome: "", capacidade: "", descricao: "", imagem_url: "" });
  const { erro, setErro, ocupado, rodar } = useAcao(recarregar, mostrar);

  async function adicionar() {
    if (!f.nome.trim()) return setErro("Dê um nome ao modelo.");
    const ok = await rodar(() => api.modelos.criar(f), "Modelo cadastrado");
    if (ok) setF({ nome: "", capacidade: "", descricao: "", imagem_url: "" });
  }

  return (
    <div>
      <div className="rounded-lg border-2 border-zinc-300 bg-white p-4">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500">Novo modelo de coletor</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Campo value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Nome (ex.: Coletor CSC-LL)" />
          <Campo value={f.capacidade} onChange={(e) => setF({ ...f, capacidade: e.target.value })} placeholder="Capacidade (ex.: 5 a 19 m³)" />
          <Campo value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="Descrição" />
          <Campo value={f.imagem_url} onChange={(e) => setF({ ...f, imagem_url: e.target.value })} placeholder="URL da imagem" />
        </div>
        <Erro>{erro}</Erro>
        <Botao onClick={adicionar} disabled={ocupado} className="mt-3">Cadastrar modelo</Botao>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4">
        {dados.modelos.map((m) => (
          <div key={m.id} className="overflow-hidden rounded-lg border-2 border-zinc-300 bg-white">
            <Foto src={m.imagem_url} alt={m.nome} className="h-36 w-full" />
            <div className="px-4 py-3">
              <input defaultValue={m.nome} disabled={ocupado}
                onBlur={(e) => e.target.value !== m.nome && rodar(() => api.modelos.atualizar(m.id, { nome: e.target.value }))}
                className="w-full bg-transparent text-base font-medium outline-none" />
              <input defaultValue={m.imagem_url ?? ""} disabled={ocupado} placeholder="URL da imagem"
                onBlur={(e) => e.target.value !== m.imagem_url && rodar(() => api.modelos.atualizar(m.id, { imagem_url: e.target.value }))}
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

function Coletores({ dados, recarregar, mostrar }) {
  const [f, setF] = useState({ chassi: "", os: "", modelo_id: dados.modelos[0]?.id ?? "", cliente: "" });
  const { erro, setErro, ocupado, rodar } = useAcao(recarregar, mostrar);

  async function adicionar() {
    if (!f.chassi.trim()) return setErro("O chassi é obrigatório.");
    const ok = await rodar(() => api.caminhoes.criar({
      ...f, etapa_atual_id: dados.etapas[0]?.id ?? null,
    }), "Coletor cadastrado");
    if (ok) setF({ chassi: "", os: "", modelo_id: dados.modelos[0]?.id ?? "", cliente: "" });
  }

  return (
    <div>
      <div className="rounded-lg border-2 border-zinc-300 bg-white p-4">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500">Cadastrar coletor na linha</h2>
        <div className="mt-3 grid grid-cols-4 gap-3">
          <Campo value={f.chassi} onChange={(e) => setF({ ...f, chassi: e.target.value.toUpperCase() })}
            placeholder="Chassi" className="font-mono" />
          <Campo value={f.os} onChange={(e) => setF({ ...f, os: e.target.value })} placeholder="OS" className="font-mono" />
          <select value={f.modelo_id} onChange={(e) => setF({ ...f, modelo_id: e.target.value })}
            className="rounded-lg border-2 border-zinc-300 px-3 py-3 outline-none">
            {dados.modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
          <Campo value={f.cliente} onChange={(e) => setF({ ...f, cliente: e.target.value })} placeholder="Cliente" />
        </div>
        <Erro>{erro}</Erro>
        <Botao onClick={adicionar} disabled={ocupado} className="mt-3">Cadastrar coletor</Botao>
      </div>

      <div className="mt-5">
        {dados.caminhoes.map((c) => {
          const m = dados.modelos.find((x) => x.id === c.modelo_id);
          const equipe = dados.sessoes.filter((s) => s.chassi === c.chassi);
          return (
            <div key={c.id} className="mb-2 rounded-lg border-2 border-zinc-300 bg-white px-4 py-3">
              <div className="flex items-center gap-4">
                <Foto src={m?.imagem_url} alt={m?.nome ?? c.chassi} className="h-16 w-24 rounded" />
                <span className="w-24 font-mono text-lg">{c.chassi}</span>
                <div className="flex-1">
                  <div className="text-sm">{m?.nome ?? "sem modelo"}</div>
                  <div className="text-xs text-zinc-500">{c.cliente || "sem cliente"} · OS {c.os || "—"}</div>
                </div>
                <select value={c.etapa_atual_id ?? ""} disabled={ocupado}
                  onChange={(e) => rodar(() => api.caminhoes.atualizar(c.id, { etapa_atual_id: e.target.value || null }), "Etapa alterada")}
                  className="rounded-lg border-2 border-zinc-300 px-3 py-2 text-sm">
                  <option value="">Sem etapa</option>
                  {dados.etapas.map((e) => <option key={e.id} value={e.id}>{e.ordem}. {e.nome}</option>)}
                </select>
                <button onClick={() => rodar(() => api.caminhoes.excluir(c.id), "Coletor removido")}
                  className="rounded border border-zinc-300 px-3 py-2 text-sm text-red-700">Remover</button>
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

// --- Linha de montagem -----------------------------------------------

function Linha({ dados, recarregar, mostrar }) {
  const [abertaId, setAbertaId] = useState(dados.etapas[0]?.id ?? null);
  const [nEtapa, setNEtapa] = useState({ nome: "", cargo_responsavel_id: dados.cargos[0]?.id ?? "" });
  const [nTarefa, setNTarefa] = useState({ descricao: "", cargo_responsavel_id: "" });
  const { erro, setErro, ocupado, rodar } = useAcao(recarregar, mostrar);

  const etapa = dados.etapas.find((e) => e.id === abertaId);

  async function addEtapa() {
    if (!nEtapa.nome.trim()) return setErro("Dê um nome à etapa.");
    const ok = await rodar(() => api.etapas.criar({
      nome: nEtapa.nome.trim(),
      cargo_responsavel_id: nEtapa.cargo_responsavel_id || null,
      ordem: dados.etapas.length + 1,
    }), "Etapa criada");
    if (ok) setNEtapa({ nome: "", cargo_responsavel_id: dados.cargos[0]?.id ?? "" });
  }

  async function addTarefa() {
    if (!nTarefa.descricao.trim()) return setErro("Descreva a tarefa.");
    const cargo = nTarefa.cargo_responsavel_id || etapa.cargo_responsavel_id;
    if (!cargo) return setErro("Defina o cargo responsável pela tarefa.");
    const ok = await rodar(() => api.tarefas.criar({
      etapa_id: etapa.id,
      descricao: nTarefa.descricao.trim(),
      cargo_responsavel_id: cargo,
      ordem: etapa.tarefas.length + 1,
    }), "Tarefa criada");
    if (ok) setNTarefa({ descricao: "", cargo_responsavel_id: "" });
  }

  const trocar = (lista, i, d, tabela) => {
    const j = i + d;
    if (j < 0 || j >= lista.length) return;
    const nova = [...lista];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    rodar(() => reordenar(tabela, nova), "Ordem atualizada");
  };

  return (
    <div className="grid grid-cols-2 gap-6">
      <div>
        <h2 className="text-xs uppercase tracking-widest text-zinc-500">Etapas</h2>
        <div className="mt-3">
          {dados.etapas.length === 0 && (
            <p className="rounded-lg border-2 border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500">
              Nenhuma etapa criada. Adicione a primeira abaixo, na ordem em que o coletor percorre a fábrica.
            </p>
          )}
          {dados.etapas.map((e, i) => (
            <div key={e.id} className={"mb-2 rounded-lg border-2 bg-white px-3 py-2 " +
              (e.id === abertaId ? "border-emerald-600" : "border-zinc-300")}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-zinc-400">{e.ordem}</span>
                <input defaultValue={e.nome} disabled={ocupado}
                  onBlur={(ev) => ev.target.value !== e.nome && rodar(() => api.etapas.atualizar(e.id, { nome: ev.target.value }))}
                  className="flex-1 bg-transparent py-1 outline-none" />
                <button onClick={() => trocar(dados.etapas, i, -1, "etapas")} className="px-2 text-zinc-500">↑</button>
                <button onClick={() => trocar(dados.etapas, i, 1, "etapas")} className="px-2 text-zinc-500">↓</button>
                <button onClick={() => setAbertaId(e.id)} className="rounded border border-zinc-300 px-3 py-1 text-sm">
                  {e.tarefas.length} tarefas
                </button>
                <button onClick={() => rodar(() => api.etapas.excluir(e.id), "Etapa excluída")}
                  className="px-2 text-red-600">×</button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-zinc-500">Cargo predominante</span>
                <select value={e.cargo_responsavel_id ?? ""} disabled={ocupado}
                  onChange={(ev) => rodar(() => api.etapas.atualizar(e.id, { cargo_responsavel_id: ev.target.value || null }))}
                  className="rounded border border-zinc-300 px-2 py-1 text-xs">
                  {dados.cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <Campo value={nEtapa.nome} onChange={(e) => setNEtapa({ ...nEtapa, nome: e.target.value })}
            placeholder="Nome da nova etapa" className="flex-1 py-2" />
          <select value={nEtapa.cargo_responsavel_id} onChange={(e) => setNEtapa({ ...nEtapa, cargo_responsavel_id: e.target.value })}
            className="rounded-lg border-2 border-zinc-300 px-2 py-2 text-sm">
            {dados.cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <Botao onClick={addEtapa} disabled={ocupado} className="px-4 py-2">Adicionar</Botao>
        </div>
        <Erro>{erro}</Erro>
      </div>

      <div>
        <h2 className="text-xs uppercase tracking-widest text-zinc-500">
          Tarefas — {etapa?.nome ?? "crie ou selecione uma etapa"}
        </h2>
        {etapa && (
          <>
            <div className="mt-3">
              {etapa.tarefas.length === 0 && (
                <p className="rounded-lg border-2 border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500">
                  Nenhuma tarefa nesta etapa. Adicione a primeira abaixo.
                </p>
              )}
              {etapa.tarefas.map((t, i) => (
                <div key={t.id} className="mb-2 rounded-lg border-2 border-zinc-300 bg-white px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-zinc-400">{t.ordem}</span>
                    <input defaultValue={t.descricao} disabled={ocupado}
                      onBlur={(ev) => ev.target.value !== t.descricao && rodar(() => api.tarefas.atualizar(t.id, { descricao: ev.target.value }))}
                      className="flex-1 bg-transparent py-1 outline-none" />
                    <button onClick={() => trocar(etapa.tarefas, i, -1, "tarefas")} className="px-1 text-zinc-500">↑</button>
                    <button onClick={() => trocar(etapa.tarefas, i, 1, "tarefas")} className="px-1 text-zinc-500">↓</button>
                    <button onClick={() => rodar(() => api.tarefas.excluir(t.id), "Tarefa excluída")}
                      className="px-1 text-red-600">×</button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <select value={t.cargo_responsavel_id} disabled={ocupado}
                      onChange={(ev) => rodar(() => api.tarefas.atualizar(t.id, { cargo_responsavel_id: ev.target.value }))}
                      className="rounded border border-zinc-300 px-2 py-1 text-xs">
                      {dados.cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                    <button disabled={ocupado}
                      onClick={() => rodar(() => api.tarefas.atualizar(t.id, { obrigatoria: !t.obrigatoria }))}
                      className={"rounded px-2 py-1 text-xs " + (t.obrigatoria ? "bg-zinc-900 text-zinc-50" : "border border-zinc-300 text-zinc-500")}>
                      {t.obrigatoria ? "obrigatória" : "opcional"}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 rounded-lg border-2 border-zinc-300 bg-white p-3">
              <Campo value={nTarefa.descricao} onChange={(e) => setNTarefa({ ...nTarefa, descricao: e.target.value })}
                placeholder="Descrição da tarefa" className="w-full py-2" />
              <div className="mt-2 flex items-center gap-2">
                <select value={nTarefa.cargo_responsavel_id} onChange={(e) => setNTarefa({ ...nTarefa, cargo_responsavel_id: e.target.value })}
                  className="flex-1 rounded-lg border-2 border-zinc-300 px-2 py-2 text-sm">
                  <option value="">Herdar da etapa</option>
                  {dados.cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
                <Botao onClick={addTarefa} disabled={ocupado} className="px-4 py-2">Adicionar</Botao>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
