import { useState } from "react";

// Imagem com degradacao elegante: se a URL falhar (rede bloqueada,
// arquivo movido no site de origem), mostra o nome no lugar do buraco.
export default function Foto({ src, alt, className = "" }) {
  const [erro, setErro] = useState(false);
  if (!src || erro) {
    return (
      <div className={"flex items-center justify-center bg-zinc-200 px-2 text-center text-xs text-zinc-500 " + className}>
        {alt}
      </div>
    );
  }
  return <img src={src} alt={alt} onError={() => setErro(true)} className={"bg-zinc-200 object-cover " + className} />;
}
