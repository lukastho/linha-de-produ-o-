import { useState, useEffect, useCallback } from "react";
import { configurado } from "./lib/supabase.js";
import { carregarCatalogo, encerrarSessao, sairAdmin, sincronizarFila } from "./lib/api.js";
import { lerFila } from "./lib/fila.js";
import Login from "./telas/Login.jsx";
import Operador from "./telas/Operador.jsx";
import Admin from "./telas/Admin.jsx";

export default function App() {
  const [sessao, setSessao] = useState(null);
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [naFila, setNaFila] = useState(lerFila().length);
  const [toast, setToast] = useState("");

  const mostrar = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2600); };

  const recarregar = useCallback(async () => {
    try {
      setDados(await carregarCatalogo());
      setErro("");
    } catch (e) {
      setErro(e.message || "Não foi possível carregar os dados.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (!configurado) { setCarregando(false); return; }
    recarregar();
  }, [recarregar]);

  // Reage a queda e volta da rede: ao voltar, esvazia a fila sozinho.
  useEffect(() => {
    const sobe = async () => {
      setOnline(true);
      const r = await sincronizarFila();
      setNaFila(r.restantes);
      if (r.enviados > 0) mostrar(`${r.enviados} registro(s) da fila enviados`);
      recarregar();
    };
    const cai = () => setOnline(false);
    window.addEventListener("online", sobe);
    window.addEventListener("offline", cai);
    return () => {
      window.removeEventListener("online", sobe);
      window.removeEventListener("offline", cai);
    };
  }, [recarregar]);

  async function sair() {
    if (sessao?.perfil === "operador") await encerrarSessao(sessao.matricula).catch(() => {});
    if (sessao?.perfil === "admin") await sairAdmin().catch(() => {});
    setSessao(null);
    recarregar();
  }

  if (!configurado) return <FaltaConfig />;

  if (carregando) {
    return <Centro><p className="text-zinc-600">Carregando a linha de montagem…</p></Centro>;
  }

  return (
    <div className="min-h-full bg-zinc-100 font-sans text-zinc-900">
      <header className="flex items-center justify-between bg-zinc-900 px-5 py-3 text-zinc-100">
        <div className="flex items-center gap-3">
          <div className="h-8 w-2 bg-emerald-500" />
          <span className="text-xs uppercase tracking-widest text-zinc-400">Montagem de coletores</span>
        </div>
        <div className="flex items-center gap-2">
          {!online && (
            <span className="rounded bg-zinc-700 px-2 py-1 text-xs uppercase tracking-widest">Sem rede</span>
          )}
          {naFila > 0 && (
            <span className="rounded bg-zinc-700 px-2 py-1 text-xs">{naFila} na fila</span>
          )}
          {sessao && (
            <span className="font-mono text-sm text-zinc-300">{sessao.matricula} · {sessao.nome}</span>
          )}
          {sessao && (
            <span className={"rounded px-2 py-1 text-xs uppercase tracking-widest " +
              (sessao.perfil === "admin" ? "bg-emerald-600" : "bg-zinc-700 text-zinc-200")}>
              {sessao.perfil === "admin" ? "Gestão" : sessao.cargo}
            </span>
          )}
          {sessao && (
            <button onClick={sair} className="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-300">
              Encerrar
            </button>
          )}
        </div>
      </header>

      {erro && (
        <p className="border-l-4 border-red-600 bg-red-50 px-5 py-3 text-sm text-red-800">{erro}</p>
      )}

      {!sessao && (
        <Login dados={dados} entrar={setSessao} />
      )}

      {sessao?.perfil === "operador" && (
        <Operador sessao={sessao} dados={dados} recarregar={recarregar}
          naFila={naFila} setNaFila={setNaFila} mostrar={mostrar} />
      )}

      {sessao?.perfil === "admin" && (
        <Admin dados={dados} recarregar={recarregar} mostrar={mostrar} />
      )}

      {toast && (
        <div className="sticky bottom-4 mx-auto w-max rounded-lg bg-zinc-900 px-5 py-3 text-sm text-zinc-50">
          {toast}
        </div>
      )}
    </div>
  );
}

function Centro({ children }) {
  return <div className="flex h-full items-center justify-center px-6 py-20 text-center">{children}</div>;
}

function FaltaConfig() {
  return (
    <Centro>
      <div className="max-w-md rounded-lg border-2 border-zinc-300 bg-white px-6 py-8 text-left">
        <h1 className="text-lg font-medium">Falta configurar o banco</h1>
        <p className="mt-2 text-sm text-zinc-600">
          As variáveis <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> não
          foram encontradas. Crie um arquivo <code>.env</code> a partir do <code>.env.example</code>
          {" "}(em desenvolvimento) ou preencha as variáveis de ambiente na Vercel (em produção)
          e publique de novo.
        </p>
      </div>
    </Centro>
  );
}
