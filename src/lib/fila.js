// Fila de envio offline.
// O tablet do chao de fabrica perde wifi. Cada marcacao recebe um
// client_uuid gerado aqui; se o envio falhar, fica na fila e e reenviado
// depois. O banco ignora duplicata pelo client_uuid, entao reenviar e seguro.

const CHAVE = "montagem.fila.v1";

export const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "id-" + Math.random().toString(36).slice(2) + Date.now();

export function lerFila() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE) || "[]");
  } catch {
    return [];
  }
}

export function gravarFila(itens) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(itens));
  } catch {
    /* storage cheio ou bloqueado: seguimos sem persistir */
  }
}

export function enfileirar(item) {
  const f = lerFila();
  f.push(item);
  gravarFila(f);
  return f;
}

export function removerDaFila(clientUuids) {
  const set = new Set(clientUuids);
  const f = lerFila().filter((i) => !set.has(i.client_uuid));
  gravarFila(f);
  return f;
}
