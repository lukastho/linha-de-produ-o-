import { useState, useEffect, useCallback } from "react";
import { statusDoCaminhao, registrar, sincronizarFila } from "../lib/api.js";
import { uid, lerFila } from "../lib/fila.js";
import Foto from "../componentes/Foto.jsx";

export default function Operador({ sessao, dados, recarregar, naFila, setNaFila, mostrar }) {
  const [status, setStatus] = useState({});
  const [modo, setModo] = useState("imediato");
  const [soMinhas, setSoMinhas] = useState(false);
  const [ocupada, setOcupada] = useState(null);

  const caminhao = dados.caminhoes.find((c) => c.id === sessao.caminhao_id);
  const modelo = caminhao ? dados.modelos.find((m) => m.id === caminhao.modelo_id) : null;
  const etapa = caminhao ? dados.etapas.find((e) => e.id === caminhao.etapa_atual_id) : null;
  const tarefas = etapa?.tarefas ?? [];

  const atualizarStatus = useCallback(async () => {
    if (!caminhao) return;
    try {
      setStatus(await statusDoCaminhao(caminhao.id));
    } catch { /* offline: mantém o que já está na tela */ }
  }, [caminhao]);

  useEffect(() => { atualizarStatus(); }, [atualizarStatus]);

  // Recarrega a cada 30s: outro operador pode ter concluído algo no mesmo coletor.
  useEffect(() => {
    const t = setInterval(atualizarStatus, 30000);
    return () => clearInterval(t);
  }, [atualizarStatus]);

  if (!caminhao) {
    return <Vazio titulo="Coletor não encontrado" texto="Encerre e entre novamente." />;
  }

  const minhas = tarefas.filter((t) => t.cargo_responsavel_id === sessao.cargo_id);
  const minhasFeitas = minhas.filter((t) => status[t.id]?.concluida).length;
  const totalFeitas = tarefas.filter((t) => status[t.id]?.concluida).length;
  const visiveis = soMinhas ? minhas : tarefas;

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
        await atualizarStatus();
        mostrar(tipo === "conclusao" ? "Tarefa concluída" : tipo === "inicio" ? "Tarefa iniciada" : "Tarefa reaberta");
      } else {
        setNaFila(lerFila().length);
        // reflete na tela mesmo sem ter ido ao servidor
        setStatus((s) => ({ ...s, [tarefa.id]: { tipo, concluida: tipo === "conclusao",
          usuario_nome: sessao.nome, data_conclusao: item.data_conclusao, pendente: true } }));
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
    await atualizarStatus();
    await recarregar();
    mostrar(r.restantes === 0 ? `${r.enviados} registro(s) enviados` : `${r.enviados} enviados, ${r.restantes} aguardando rede`);
  }

  return (
    <div>
      <div className="bg-white px-5 py-4">
        <div className="flex items-start gap-4">
          <Foto src={modelo?.imagem_url} alt={modelo?.nome ?? caminhao.chassi} className="h-24 w-40 rounded-lg" />
          <div className="flex-1">
            <span className="text-xs uppercase tracking-widest text-zinc-500">Coletor em produção</span>
            <div className="text-xl font-medium">{modelo?.nome ?? "Modelo não cadastrado"}</div>
            <div className="text-sm text-zinc-600">
              Chassi <span className="font-mono">{caminhao.chassi}</span> · {caminhao.cliente}
            </div>
            {modelo?.capacidade && <div className="text-xs text-zinc-500">Capacidade {modelo.capacidade}</div>}
          </div>
          {etapa && (
            <div className="text-right">
              <div className="text-3xl font-medium">{minhasFeitas}<span className="text-zinc-400">/{minhas.length}</span></div>
              <div className="text-xs uppercase tracking-widest text-zinc-500">suas tarefas</div>
              <div className="mt-1 text-xs text-zinc-500">{totalFeitas}/{tarefas.length} na etapa</div>
            </div>
          )}
        </div>

        {dados.etapas.length > 0 && (
          <div className="mt-4 flex gap-1">
            {dados.etapas.map((e) => {
              const atual = e.id === caminhao.etapa_atual_id;
              const passou = etapa ? e.ordem < etapa.ordem : false;
              return (
                <div key={e.id} className="flex-1">
                  <div className={"h-2 " + (passou ? "bg-emerald-700" : atual ? "bg-emerald-400" : "bg-zinc-200")} />
                  <div className={"mt-2 text-xs leading-tight " + (atual ? "font-medium text-zinc-900" : "text-zinc-400")}>
                    {e.nome}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!etapa ? (
        <Vazio titulo="Checklist ainda não configurado"
          texto="A gestão ainda não definiu a etapa deste coletor. Assim que as etapas e tarefas forem criadas no painel, elas aparecem aqui." />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-y border-zinc-300 bg-zinc-50 px-5 py-3">
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
                Nenhuma tarefa de {sessao.cargo} nesta etapa.
              </p>
            )}

            {visiveis.map((t) => {
              const r = status[t.id];
              const estado = r?.tipo === "conclusao" ? "concluida" : r?.tipo === "inicio" ? "andamento" : "pendente";
              const minha = t.cargo_responsavel_id === sessao.cargo_id;
              const cargo = dados.cargos.find((c) => c.id === t.cargo_responsavel_id);

              return (
                <div key={t.id}
                  className={"mb-3 flex items-center gap-4 rounded-lg border-2 px-4 py-3 " +
                    (!minha ? "border-zinc-200 bg-zinc-50"
                      : estado === "concluida" ? "border-emerald-600 bg-emerald-50"
                      : estado === "andamento" ? "border-zinc-900 bg-white"
                      : "border-zinc-300 bg-white")}>
                  <div className="flex-1">
                    <div className={"text-lg leading-snug " + (minha ? "" : "text-zinc-500")}>{t.descricao}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className={"rounded px-2 py-1 text-xs uppercase tracking-widest " +
                        (minha ? "bg-emerald-600 text-white" : "bg-zinc-200 text-zinc-600")}>
                        {cargo?.nome ?? "sem cargo"}
                      </span>
                      {estado === "concluida" && (
                        <span className="rounded border border-emerald-600 px-2 py-1 text-xs uppercase tracking-widest text-emerald-800">
                          Concluída
                        </span>
                      )}
                      {estado === "andamento" && (
                        <span className="rounded bg-zinc-900 px-2 py-1 text-xs uppercase tracking-widest text-zinc-50">
                          Em andamento
                        </span>
                      )}
                      <span className="text-xs text-zinc-500">
                        {r ? `${r.usuario_nome ?? sessao.nome} · ${hora(r.data_conclusao)}${r.pendente ? " · na fila" : ""}`
                           : t.obrigatoria ? "Obrigatória" : "Opcional"}
                      </span>
                    </div>
                  </div>

                  {!minha ? (
                    <div className="flex h-16 w-40 items-center justify-center rounded-lg bg-zinc-100 px-3 text-center text-xs leading-tight text-zinc-500">
                      Exige cargo:<br />{cargo?.nome}
                    </div>
                  ) : (
                    <button disabled={ocupada === t.id}
                      onClick={() => marcar(t, estado === "pendente" ? "inicio" : estado === "andamento" ? "conclusao" : "reabertura")}
                      className={"h-16 w-40 rounded-lg font-medium " +
                        (estado === "pendente" ? "border-2 border-zinc-900 bg-white"
                          : estado === "andamento" ? "bg-emerald-600 text-white"
                          : "border-2 border-zinc-300 bg-white text-zinc-600")}>
                      {ocupada === t.id ? "…" : estado === "pendente" ? "Iniciar" : estado === "andamento" ? "OK" : "Desfazer"}
                    </button>
                  )}
                </div>
              );
            })}
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
