import { supabase } from "./supabase.js";
import { lerFila, enfileirar, removerDaFila } from "./fila.js";

// ---------------------------------------------------------------------
// Leitura do catálogo da linha
// ---------------------------------------------------------------------

// O catálogo NÃO carrega tarefas: com o padrão copiado para cada caminhão,
// seriam ~93 por coletor, e o Supabase corta em 1000 linhas sem avisar.
// As tarefas vêm por caminhão, em carregarChecklist().
export async function carregarCatalogo() {
  const [cargos, modelos, etapas, caminhoes, usuarios, sessoes] = await Promise.all([
    supabase.from("cargos").select("*").order("nome"),
    supabase.from("modelos").select("*").order("nome"),
    supabase.from("etapas").select("*").eq("ativo", true).order("ordem"),
    supabase.from("caminhoes").select("*").order("chassi"),
    supabase.from("v_usuarios_publico").select("*").order("matricula"),
    supabase.from("v_sessoes_ativas").select("*"),
  ]);

  const erro = [cargos, modelos, etapas, caminhoes, usuarios, sessoes].find((r) => r.error);
  if (erro) throw erro.error;

  return {
    cargos: cargos.data,
    modelos: modelos.data,
    caminhoes: caminhoes.data,
    usuarios: usuarios.data,
    sessoes: sessoes.data,
    etapas: etapas.data,
  };
}

// Etapas visíveis para um caminhão: as dele (cópias do padrão) e as antigas
// compartilhadas (caminhao_id nulo), cada uma com suas tarefas.
export const etapasDoCaminhao = (etapas, caminhaoId) =>
  etapas.filter((e) => !e.caminhao_id || e.caminhao_id === caminhaoId);

export async function carregarChecklist(caminhaoId) {
  const { data: etapas, error: e1 } = await supabase.from("etapas").select("*")
    .eq("ativo", true)
    .or(`caminhao_id.is.null,caminhao_id.eq.${caminhaoId}`)
    .order("ordem");
  if (e1) throw e1;
  if (etapas.length === 0) return [];

  const { data: tarefas, error: e2 } = await supabase.from("tarefas").select("*")
    .in("etapa_id", etapas.map((e) => e.id))
    .eq("ativo", true)
    .order("ordem");
  if (e2) throw e2;

  const porEtapa = {};
  for (const t of tarefas) (porEtapa[t.etapa_id] ??= []).push(t);
  return etapas.map((e) => ({ ...e, tarefas: porEtapa[e.id] ?? [] }));
}

export async function contarPadraoDoCaminhao(caminhaoId) {
  const etapas = await carregarChecklist(caminhaoId);
  const proprias = etapas.filter((e) => e.caminhao_id === caminhaoId);
  return { etapas: proprias.length, tarefas: proprias.reduce((n, e) => n + e.tarefas.length, 0) };
}

// ---------------------------------------------------------------------
// Padrão de fábrica (templates) — só a gestão enxerga
// ---------------------------------------------------------------------

export async function carregarPadrao() {
  const [etapas, tarefas] = await Promise.all([
    supabase.from("etapas_padrao").select("*").eq("ativo", true).order("ordem"),
    supabase.from("tarefas_padrao").select("*").eq("ativo", true).order("ordem"),
  ]);
  if (etapas.error) throw traduzir(etapas.error);
  if (tarefas.error) throw traduzir(tarefas.error);
  const porEtapa = {};
  for (const t of tarefas.data) (porEtapa[t.etapa_padrao_id] ??= []).push(t);
  return etapas.data.map((e) => ({ ...e, tarefas: porEtapa[e.id] ?? [] }));
}

export async function aplicarPadraoATodos() {
  const { data, error } = await supabase.rpc("aplicar_padrao_a_todos");
  if (error) throw traduzir(error);
  return data;
}

export async function reordenarPadrao(qual, ids) {
  const fn = qual === "etapas" ? "reordenar_etapas_padrao" : "reordenar_tarefas_padrao";
  const { error } = await supabase.rpc(fn, { p_ids: ids });
  if (error) throw traduzir(error);
}

export async function carregarRegistros(caminhaoId) {
  const q = supabase.from("registros_execucao")
    .select("*, usuarios(nome, matricula), tarefas(descricao, grupo, etapas(nome))")
    .order("data_conclusao", { ascending: false });
  const { data, error } = caminhaoId ? await q.eq("caminhao_id", caminhaoId) : await q.limit(300);
  if (error) throw error;
  return data;
}

export async function statusDoCaminhao(caminhaoId) {
  const { data, error } = await supabase.from("v_status_tarefas").select("*").eq("caminhao_id", caminhaoId);
  if (error) throw error;
  const mapa = {};
  for (const r of data) mapa[r.tarefa_id] = r;
  return mapa;
}

// ---------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------

export async function loginOperador(matricula, chassi, pin = null) {
  const { data, error } = await supabase.rpc("login_operador", {
    p_matricula: matricula, p_chassi: chassi, p_pin: pin,
  });
  if (error) throw traduzir(error);
  return data;
}

export async function loginAdmin(email, senha) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) throw new Error("E-mail ou senha incorretos.");
  const { data: perfil } = await supabase.from("usuarios").select("*")
    .eq("auth_user_id", data.user.id).maybeSingle();
  if (!perfil?.e_admin) {
    await supabase.auth.signOut();
    throw new Error("Esta conta não tem permissão de gestão.");
  }
  return perfil;
}

export async function sairAdmin() {
  await supabase.auth.signOut();
}

export async function encerrarSessao(matricula) {
  await supabase.rpc("encerrar_sessao", { p_matricula: matricula });
}

function traduzir(error) {
  const m = error.message || "";
  if (m.includes("MATRICULA_NAO_ENCONTRADA"))
    return new Error("Matrícula não cadastrada. Procure a gestão para liberar seu acesso.");
  if (m.includes("CHASSI_NAO_ENCONTRADO"))
    return new Error("Chassi não encontrado na linha de produção.");
  if (m.includes("PIN_INVALIDO")) return new Error("PIN incorreto.");
  if (m.includes("CARGO_INCOMPATIVEL"))
    return new Error("Esta tarefa é de outro cargo. Você não pode marcá-la.");
  if (m.includes("TAREFA_DE_OUTRO_CAMINHAO"))
    return new Error("Esta tarefa pertence a outro coletor. Encerre e entre no chassi certo.");
  if (m.includes("PADRAO_DE_FABRICA"))
    return new Error("Item do padrão de fábrica: é obrigatório e não pode ser excluído.");
  if (m.includes("SOMENTE_GESTAO"))
    return new Error("Apenas a gestão pode fazer isso.");
  // chave estrangeira: tentativa de apagar algo que tem histórico ligado
  if (error.code === "23503")
    return new Error("Não é possível excluir: há registros ligados a este item. Desative em vez de excluir.");
  if (error.code === "23505")
    return new Error("Já existe um item com esse valor.");
  return new Error(m || "Falha de comunicação com o servidor.");
}

// ---------------------------------------------------------------------
// Marcação de tarefas, com fila offline
// ---------------------------------------------------------------------

export async function enviarRegistro(item) {
  const { data, error } = await supabase.rpc("registrar_execucao", {
    p_client_uuid: item.client_uuid,
    p_matricula: item.matricula,
    p_caminhao_id: item.caminhao_id,
    p_tarefa_id: item.tarefa_id,
    p_tipo: item.tipo,
    p_data_conclusao: item.data_conclusao,
    p_dispositivo: item.dispositivo ?? navigator.userAgent.slice(0, 120),
  });
  if (error) throw traduzir(error);
  return data;
}

// Tenta enviar na hora; se falhar por rede, guarda na fila.
export async function registrar(item, modo) {
  if (modo === "lote") {
    enfileirar(item);
    return { enviado: false };
  }
  try {
    await enviarRegistro(item);
    return { enviado: true };
  } catch (e) {
    if (e.message.includes("outro cargo")) throw e; // erro de regra, não de rede
    enfileirar(item);
    return { enviado: false, motivo: "sem conexão — guardado na fila" };
  }
}

export async function sincronizarFila() {
  const fila = lerFila();
  if (fila.length === 0) return { enviados: 0, restantes: 0 };
  const ok = [];
  for (const item of fila) {
    try {
      await enviarRegistro(item);
      ok.push(item.client_uuid);
    } catch (e) {
      if (e.message.includes("outro cargo")) ok.push(item.client_uuid); // descarta inválido
      else break; // rede caiu de novo: para e tenta depois
    }
  }
  const restantes = removerDaFila(ok);
  return { enviados: ok.length, restantes: restantes.length };
}

// ---------------------------------------------------------------------
// Escritas da gestão (protegidas por RLS: só admin autenticado passa)
// ---------------------------------------------------------------------

const tabela = (nome) => ({
  criar: async (registro) => {
    const { data, error } = await supabase.from(nome).insert(registro).select().single();
    if (error) throw traduzir(error);
    return data;
  },
  atualizar: async (id, patch) => {
    const { data, error } = await supabase.from(nome).update(patch).eq("id", id).select().single();
    if (error) throw traduzir(error);
    return data;
  },
  excluir: async (id) => {
    const { error } = await supabase.from(nome).delete().eq("id", id);
    if (error) throw traduzir(error);
  },
});

export const api = {
  cargos: tabela("cargos"),
  usuarios: tabela("usuarios"),
  modelos: tabela("modelos"),
  etapas: tabela("etapas"),
  tarefas: tabela("tarefas"),
  caminhoes: tabela("caminhoes"),
  etapasPadrao: tabela("etapas_padrao"),
  tarefasPadrao: tabela("tarefas_padrao"),
};
