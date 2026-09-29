import { useState, useEffect, useCallback, useMemo } from "react";
import { carregarChecklist, statusDoCaminhao, registrar, sincronizarFila } from "../lib/api.js";
import { uid, lerFila } from "../lib/fila.js";
import Foto from "../componentes/Foto.jsx";

export default function Operador({ sessao, dados, recarregar, naFila, setNaFila, mostrar }) {
  const [etapas, setEtapas] = useState(null);      // checklist do caminhão
  const [status, setStatus] = useState({});
  const [abertaId, setAbertaId] = useState(null);
  const [modo, setModo] = useState("imediato");
  const [soMinhas, setSoMinhas] = useState(false);
  const [ocupada, setOcupada] = useState(null);
  const [seletorAberto, setSeletorAberto] = useState(false);
  const [erro, setErro] = useState("");

  const caminhao = dados.caminhoes.find((c) => c.id === sessao.caminhao_id);
  const modelo = caminhao ? dados.modelos.find((m) => m.id === caminhao.modelo_id) : null;

  const atualizar = useCallback(async () => {
    if (!caminhao) return;
    try {
      const [lista, st] = await Promise.all([carregarChecklist(caminhao.id), statusDoCaminhao(caminhao.id)]);
      setEtapas(lista);
      setStatus(st);
      setErro("");
    } catch (e) {
      // offline: mantém o que já está na tela
      if (etapas === null) setErro("Não foi possível carregar o checklist. Verifique a conexão.");
    }
  }, [caminhao]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { atualizar(); }, [atualizar]);

  // outro operador pode estar marcando no mesmo coletor
  useEffect(() => {
    const t = setInterval(atualizar, 30000);
    return () => clearInterval(t);
  }, [atualizar]);

  const feita = (t) => status[t.id]?.concluida;
  const minha = (t) => t.cargo_responsavel_id === sessao.cargo_id;

  // Abre na primeira etapa com trabalho pendente para o cargo de quem entrou.
  // Hidráulica e elétrica andam em paralelo na fábrica: mostrar só a "etapa
  // atual" deixaria o eletricista sem tarefa enquanto o caminhão está na hidráulica.
  useEffect(() => {
    if (!etapas || abertaId) return;
    const comPendencia = etapas.find((e) => e.tarefas.some((t) => minha(t) && !feita(t)));
    const atual = etapas.find((e) => e.id === caminhao?.etapa_atual_id);
    setAbertaId((comPendencia ?? atual ?? etapas[0])?.id ?? null);
  }, [etapas, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const etapa = etapas?.find((e) => e.id === abertaId) ?? null;
  const tarefas = etapa?.tarefas ?? [];
  const visiveis = soMinhas ? tarefas.filter(minha) : tarefas;

  // agrupa pelas seções do checklist em papel (PTO E BOMBA, MANGUEIRAS...)
  // Agrupa por NOME de seção (não por posição): uma tarefa acrescentada ao
  // padrão depois cai no fim da etapa, mas aparece dentro da seção certa.
  const grupos = useMemo(() => {
    const mapa = new Map();
    for (const t of visiveis) {
      const nome = t.grupo ?? "";
      if (!mapa.has(nome)) mapa.set(nome, { nome, tarefas: [] });
      mapa.get(nome).tarefas.push(t);
    }
    return [...mapa.values()];
  }, [visiveis]);

  if (!caminhao) return <Vazio titulo="Coletor não encontrado" texto="Encerre e entre novamente." />;

  async function marcar(tarefa, tipo) {
    setOcupada(tarefa.id);
    const item = {
      client_uuid: uid(),
      matricula: sessao.matricula,
      caminhao_id: caminhao.id,
      tarefa_id: tarefa.id,
      tipo,
      data_conclusao: new Date().toISOString(),
    };
    try {
      const r = await registrar(item, modo);
      if (r.enviado) {
        setStatus(await statusDoCaminhao(caminhao.id));
        mostrar(tipo === "conclusao" ? "Tarefa concluída" : tipo === "inicio" ? "Tarefa iniciada" : "Tarefa reaberta");
      } else {
        setNaFila(lerFila().length);
        setStatus((s) => ({ ...s, [tarefa.id]: {
          tipo, concluida: tipo === "conclusao", usuario_nome: sessao.nome,
          data_conclusao: item.data_conclusao, pendente: true,
        } }));
        if (r.motivo) mostrar(r.motivo);
      }
    } catch (e) {
      mostrar(e.message);
    } finally {
      setOcupada(null);
    }
  }

  async function enviarTudo() {
    const r = await sincronizarFila();
    setNaFila(r.restantes);
    await atualizar();
    await recarregar();
    mostrar(r.restantes === 0 ? `${r.enviados} registro(s) enviados` : `${r.enviados} enviados, ${r.restantes} aguardando rede`);
  }

  const minhasNaEtapa = tarefas.filter(minha);
  const minhasFeitas = minhasNaEtapa.filter(feita).length;

  return (
    <div>
      <div className="bg-white px-5 py-4">
        <div className="flex flex-wrap items-start gap-4">
          <Foto src={modelo?.imagem_url} alt={modelo?.nome ?? caminhao.chassi} className="h-16 w-24 shrink-0 rounded-lg sm:h-24 sm:w-40" />
          <div className="min-w-0 flex-1">
            <span className="text-xs uppercase tracking-widest text-zinc-500">Coletor em produção</span>
            <div className="text-xl font-medium">{modelo?.nome ?? "Modelo não cadastrado"}</div>
            <div className="text-sm text-zinc-600">
              Chassi <span className="font-mono">{caminhao.chassi}</span> · {caminhao.cliente}
            </div>
            {modelo?.capacidade && <div className="text-xs text-zinc-500">Capacidade {modelo.capacidade}</div>}
          </div>
          {etapa && minhasNaEtapa.length > 0 && (
            <div className="hidden text-right sm:block">
              <div className="text-3xl font-medium">{minhasFeitas}<span className="text-zinc-400">/{minhasNaEtapa.length}</span></div>
              <div className="text-xs uppercase tracking-widest text-zinc-500">suas nesta etapa</div>
            </div>
          )}
        </div>
      </div>

      {erro && <p className="border-l-4 border-red-600 bg-red-50 px-5 py-3 text-sm text-red-800">{erro}</p>}

      {etapas === null && !erro && (
        <p className="px-5 py-10 text-center text-sm text-zinc-500">Carregando checklist…</p>
      )}

      {etapas?.length === 0 && (
        <Vazio titulo="Checklist ainda não configurado"
          texto="Este coletor ainda não recebeu as etapas do padrão de fábrica. Avise a gestão." />
      )}

      {etapas?.length > 0 && (
        <>
          {/* celular: um botão com a etapa aberta; tocar abre a janela com todas */}
          <div className="border-b-2 border-zinc-300 bg-white px-4 py-3 sm:hidden">
            <button onClick={() => setSeletorAberto(true)}
              className="flex w-full items-center gap-3 rounded-lg border-2 border-zinc-300 px-4 py-3 text-left">
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-widest text-zinc-500">
                  Etapa {etapas.findIndex((e) => e.id === abertaId) + 1} de {etapas.length}
                </div>
                <div className="truncate font-medium">{etapa?.nome}</div>
                <div className="text-xs text-zinc-500">
                  {etapa ? `${etapa.tarefas.filter(feita).length}/${etapa.tarefas.length} concluídas` : ""} · toque para trocar
                </div>
              </div>
              <span className="text-xl text-zinc-400" aria-hidden="true">▾</span>
            </button>
          </div>

          {/* tablet e computador: abas */}
          <div className="hidden gap-1 overflow-x-auto border-b-2 border-zinc-300 bg-white px-3 sm:flex">
            {etapas.map((e) => {
              const total = e.tarefas.length;
              const ok = e.tarefas.filter(feita).length;
              const pendenteMinha = e.tarefas.some((t) => minha(t) && !feita(t));
              const aberta = e.id === abertaId;
              return (
                <button key={e.id} onClick={() => setAbertaId(e.id)}
                  className={"shrink-0 px-4 pb-2 pt-3 text-left " +
                    (aberta ? "border-b-4 border-emerald-600" : "border-b-4 border-transparent")}>
                  <div className="flex items-center gap-2">
                    {pendenteMinha && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
                    <span className={"text-sm " + (aberta ? "font-medium text-zinc-900" : "text-zinc-600")}>{e.nome}</span>
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {ok}/{total}{e.id === caminhao.etapa_atual_id ? " · etapa atual" : ""}
                  </div>
                </button>
              );
            })}
          </div>

          {seletorAberto && (
            <SeletorEtapas etapas={etapas} abertaId={abertaId} etapaAtualId={caminhao.etapa_atual_id}
              feita={feita} minha={minha}
              escolher={(id) => { setAbertaId(id); setSeletorAberto(false); window.scrollTo({ top: 0 }); }}
              fechar={() => setSeletorAberto(false)} />
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-300 bg-zinc-50 px-5 py-3">
            <button onClick={() => setSoMinhas(!soMinhas)}
              className={"rounded px-4 py-2 text-sm " + (soMinhas ? "bg-emerald-600 text-white" : "border border-zinc-300 bg-white text-zinc-600")}>
              {soMinhas ? "Mostrando só as minhas" : "Ver só as minhas tarefas"}
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-600">Envio</span>
              {["imediato", "lote"].map((m) => (
                <button key={m} onClick={() => setModo(m)}
                  className={"rounded px-4 py-2 text-sm " + (modo === m ? "bg-zinc-900 text-zinc-50" : "border border-zinc-300 bg-white text-zinc-600")}>
                  {m === "imediato" ? "Salvar na hora" : "Acumular lote"}
                </button>
              ))}
            </div>
          </div>

          <div className="px-5 py-4">
            {visiveis.length === 0 && (
              <p className="rounded-lg border-2 border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
                {soMinhas ? `Nenhuma tarefa de ${sessao.cargo} nesta etapa.` : "Esta etapa não tem tarefas."}
              </p>
            )}

            {grupos.map((g) => (
              <section key={g.nome || "_"} className="mb-5">
                {g.nome && (
                  <h3 className="mb-2 mt-1 text-xs uppercase tracking-widest text-zinc-500">
                    {g.nome}
                    <span className="ml-2 text-zinc-400">{g.tarefas.filter(feita).length}/{g.tarefas.length}</span>
                  </h3>
                )}
                {g.tarefas.map((t) => (
                  <LinhaTarefa key={t.id} t={t} r={status[t.id]} minha={minha(t)}
                    cargo={dados.cargos.find((c) => c.id === t.cargo_responsavel_id)}
                    ocupada={ocupada === t.id} marcar={marcar} sessao={sessao} />
                ))}
              </section>
            ))}
          </div>

          {(modo === "lote" || naFila > 0) && (
            <div className="sticky bottom-0 flex items-center justify-between border-t-2 border-zinc-900 bg-white px-5 py-4">
              <span className="text-sm text-zinc-600">
                {naFila === 0 ? "Nenhum registro na fila" : `${naFila} registro(s) aguardando envio`}
              </span>
              <button onClick={enviarTudo} disabled={naFila === 0}
                className={"h-14 rounded-lg px-6 font-medium " + (naFila === 0 ? "bg-zinc-200 text-zinc-400" : "bg-emerald-600 text-white")}>
                Enviar registros
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Janela que sobe de baixo no celular, com todas as etapas do coletor.
function SeletorEtapas({ etapas, abertaId, etapaAtualId, feita, minha, escolher, fechar }) {
  useEffect(() => {
    const esc = (e) => e.key === "Escape" && fechar();
    document.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";           // não rola a página por trás
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [fechar]);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black bg-opacity-50" onClick={fechar}
      role="dialog" aria-modal="true" aria-label="Escolher etapa">
      <div className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white px-4 pt-3"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-300" />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">Etapas deste coletor</h2>
          <button onClick={fechar} className="rounded border border-zinc-300 px-3 py-2 text-sm">Fechar</button>
        </div>
        {etapas.map((e) => {
          const total = e.tarefas.length;
          const ok = e.tarefas.filter(feita).length;
          const minhas = e.tarefas.filter(minha);
          const pendentesMinhas = minhas.filter((t) => !feita(t)).length;
          const aberta = e.id === abertaId;
          const pct = total ? Math.round((ok / total) * 100) : 0;
          return (
            <button key={e.id} onClick={() => escolher(e.id)}
              className={"mb-2 w-full rounded-lg border-2 px-4 py-3 text-left " +
                (aberta ? "border-emerald-600 bg-emerald-50" : "border-zinc-300 bg-white")}>
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 font-medium">{e.nome}</span>
                <span className="shrink-0 text-sm text-zinc-600">{ok}/{total}</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-200">
                <div className="h-2 rounded-full bg-emerald-600" style={{ width: pct + "%" }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {pendentesMinhas > 0 && (
                  <span className="flex items-center gap-1 text-emerald-800">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    {pendentesMinhas} {pendentesMinhas === 1 ? "tarefa sua pendente" : "tarefas suas pendentes"}
                  </span>
                )}
                {minhas.length === 0 && <span className="text-zinc-500">nenhuma tarefa do seu cargo</span>}
                {e.id === etapaAtualId && <span className="text-zinc-500">· etapa atual</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LinhaTarefa({ t, r, minha, cargo, ocupada, marcar, sessao }) {
  const estado = r?.tipo === "conclusao" ? "concluida" : r?.tipo === "inicio" ? "andamento" : "pendente";
  return (
    <div className={"mb-2 flex flex-wrap items-center gap-3 rounded-lg border-2 px-4 py-3 sm:flex-nowrap " +
      (!minha ? "border-zinc-200 bg-zinc-50"
        : estado === "concluida" ? "border-emerald-600 bg-emerald-50"
        : estado === "andamento" ? "border-zinc-900 bg-white"
        : "border-zinc-300 bg-white")}>
      <div className="min-w-0 flex-1">
        <div className={"text-base leading-snug " + (minha ? "" : "text-zinc-500")}>{t.descricao}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {!minha && (
            <span className="rounded bg-zinc-200 px-2 py-1 text-xs uppercase tracking-widest text-zinc-600">
              {cargo?.nome ?? "sem cargo"}
            </span>
          )}
          {estado === "concluida" && (
            <span className="rounded border border-emerald-600 px-2 py-1 text-xs uppercase tracking-widest text-emerald-800">Concluída</span>
          )}
          {estado === "andamento" && (
            <span className="rounded bg-zinc-900 px-2 py-1 text-xs uppercase tracking-widest text-zinc-50">Em andamento</span>
          )}
          {r && (
            <span className="text-xs text-zinc-500">
              {r.usuario_nome ?? sessao.nome} · {hora(r.data_conclusao)}{r.pendente ? " · na fila" : ""}
            </span>
          )}
          {!r && !t.obrigatoria && <span className="text-xs text-zinc-500">Opcional</span>}
        </div>
      </div>

      {!minha ? (
        <div className="flex h-14 w-full items-center justify-center rounded-lg bg-zinc-100 px-3 text-center text-xs leading-tight text-zinc-500 sm:w-36">
          Exige cargo: {cargo?.nome}
        </div>
      ) : (
        <button disabled={ocupada}
          onClick={() => marcar(t, estado === "pendente" ? "inicio" : estado === "andamento" ? "conclusao" : "reabertura")}
          className={"h-14 w-full rounded-lg font-medium sm:w-36 " +
            (estado === "pendente" ? "border-2 border-zinc-900 bg-white"
              : estado === "andamento" ? "bg-emerald-600 text-white"
              : "border-2 border-zinc-300 bg-white text-zinc-600")}>
          {ocupada ? "…" : estado === "pendente" ? "Iniciar" : estado === "andamento" ? "OK" : "Desfazer"}
        </button>
      )}
    </div>
  );
}

const hora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function Vazio({ titulo, texto }) {
  return (
    <div className="px-5 py-10">
      <div className="mx-auto max-w-lg rounded-lg border-2 border-dashed border-zinc-300 bg-white px-6 py-10 text-center">
        <h2 className="text-lg font-medium">{titulo}</h2>
        <p className="mt-2 text-sm text-zinc-600">{texto}</p>
      </div>
    </div>
  );
}
