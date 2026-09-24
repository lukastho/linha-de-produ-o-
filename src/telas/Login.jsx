import { useState } from "react";
import { loginOperador, loginAdmin } from "../lib/api.js";
import Foto from "../componentes/Foto.jsx";

const ADMIN_MATRICULA = "3454";
const ADMIN_CHASSI = "0000";

export default function Login({ dados, entrar }) {
  const [matricula, setMatricula] = useState("");
  const [chassi, setChassi] = useState("");
  const [campo, setCampo] = useState("matricula");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [pedindoSenha, setPedindoSenha] = useState(false);

  const teclas = ["1","2","3","4","5","6","7","8","9","apagar","0","entrar"];
  const modeloDe = (c) => dados.modelos.find((m) => m.id === c.modelo_id);

  function tecla(v) {
    setErro("");
    const set = campo === "matricula" ? setMatricula : setChassi;
    const atual = campo === "matricula" ? matricula : chassi;
    if (v === "apagar") set(atual.slice(0, -1));
    else if (atual.length < 17) set(atual + v);
  }

  async function tentar() {
    setErro("");
    // A combinação 3454 + 0000 é a porta da gestão. A tranca é a senha.
    if (matricula === ADMIN_MATRICULA && chassi === ADMIN_CHASSI) {
      setPedindoSenha(true);
      return;
    }
    setOcupado(true);
    try {
      const ctx = await loginOperador(matricula, chassi);
      entrar({ perfil: "operador", ...ctx });
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado(false);
    }
  }

  if (pedindoSenha) {
    return <SenhaAdmin entrar={entrar} voltar={() => setPedindoSenha(false)} />;
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-medium">Identifique-se para começar</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Digite sua matrícula e escolha abaixo o coletor em que você vai trabalhar.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <Campo rotulo="Matrícula" valor={matricula} onChange={setMatricula}
          ativo={campo === "matricula"} onFocus={() => setCampo("matricula")} placeholder="1001" />
        <Campo rotulo="Chassi" valor={chassi} onChange={setChassi}
          ativo={campo === "chassi"} onFocus={() => setCampo("chassi")} placeholder="toque num coletor" />
      </div>

      {erro && <p className="mt-4 border-l-4 border-red-600 bg-red-50 px-4 py-3 text-sm text-red-800">{erro}</p>}

      <h2 className="mt-8 text-xs uppercase tracking-widest text-zinc-500">Coletores na linha</h2>
      <div className="mt-3 grid grid-cols-2 gap-4">
        {dados.caminhoes.map((c) => {
          const m = modeloDe(c);
          const etapa = dados.etapas.find((e) => e.id === c.etapa_atual_id);
          const sel = chassi === c.chassi;
          return (
            <button key={c.id} onClick={() => { setChassi(c.chassi); setCampo("chassi"); setErro(""); }}
              className={"overflow-hidden rounded-lg border-2 bg-white text-left " +
                (sel ? "border-emerald-600" : "border-zinc-300")}>
              <Foto src={m?.imagem_url} alt={m?.nome ?? c.chassi} className="h-36 w-full" />
              <div className="px-4 py-3">
                <div className="text-base font-medium">{m?.nome ?? "Modelo não cadastrado"}</div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="font-mono text-sm text-zinc-600">{c.chassi}</span>
                  <span className="text-xs text-zinc-500">{c.cliente}</span>
                </div>
                <div className="mt-2 text-xs text-zinc-500">
                  {etapa ? etapa.nome : "Nenhuma etapa definida ainda"}
                </div>
              </div>
            </button>
          );
        })}
        {dados.caminhoes.length === 0 && (
          <p className="col-span-2 rounded-lg border-2 border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
            Nenhum coletor cadastrado. A gestão precisa cadastrar pelo painel.
          </p>
        )}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        {teclas.map((t) => (
          <button key={t} disabled={ocupado}
            onClick={() => (t === "entrar" ? tentar() : tecla(t))}
            className={"h-20 rounded-lg text-2xl font-medium " +
              (t === "entrar" ? "bg-emerald-600 text-white"
                : t === "apagar" ? "border-2 border-zinc-300 bg-white text-base text-zinc-600"
                : "border-2 border-zinc-300 bg-white font-mono")}>
            {t === "entrar" ? (ocupado ? "…" : "Entrar") : t === "apagar" ? "Apagar" : t}
          </button>
        ))}
      </div>

      <p className="mt-5 text-xs text-zinc-500">
        Gestão: matrícula {ADMIN_MATRICULA} com o chassi {ADMIN_CHASSI}, depois a senha da conta.
      </p>
    </div>
  );
}

function SenhaAdmin({ entrar, voltar }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function confirmar() {
    setOcupado(true);
    setErro("");
    try {
      const perfil = await loginAdmin(email, senha);
      entrar({ perfil: "admin", nome: perfil.nome, matricula: perfil.matricula, usuario_id: perfil.id });
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-6 py-10">
      <h1 className="text-2xl font-medium">Acesso da gestão</h1>
      <p className="mt-1 text-sm text-zinc-600">
        A matrícula abre a porta; a senha é o que protege os cadastros da linha.
      </p>

      <label className="mt-6 block text-xs uppercase tracking-widest text-zinc-500">E-mail</label>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username"
        className="mt-1 w-full rounded-lg border-2 border-zinc-300 px-4 py-3 outline-none" />

      <label className="mt-4 block text-xs uppercase tracking-widest text-zinc-500">Senha</label>
      <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password"
        onKeyDown={(e) => e.key === "Enter" && confirmar()}
        className="mt-1 w-full rounded-lg border-2 border-zinc-300 px-4 py-3 outline-none" />

      {erro && <p className="mt-4 border-l-4 border-red-600 bg-red-50 px-4 py-3 text-sm text-red-800">{erro}</p>}

      <div className="mt-6 flex gap-3">
        <button onClick={voltar} className="h-14 flex-1 rounded-lg border-2 border-zinc-300 bg-white">Voltar</button>
        <button onClick={confirmar} disabled={ocupado}
          className="h-14 flex-1 rounded-lg bg-emerald-600 font-medium text-white">
          {ocupado ? "Entrando…" : "Entrar"}
        </button>
      </div>
    </div>
  );
}

function Campo({ rotulo, valor, onChange, ativo, onFocus, placeholder }) {
  return (
    <div onClick={onFocus}
      className={"rounded-lg border-2 bg-white px-4 py-3 " + (ativo ? "border-emerald-600" : "border-zinc-300")}>
      <label className="block text-xs uppercase tracking-widest text-zinc-500">{rotulo}</label>
      <input value={valor} onChange={(e) => onChange(e.target.value.toUpperCase())} onFocus={onFocus}
        placeholder={placeholder}
        className="w-full bg-transparent font-mono text-3xl outline-none placeholder:text-base placeholder:text-zinc-300" />
    </div>
  );
}
