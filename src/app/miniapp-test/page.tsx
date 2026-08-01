// Página mínima para probar el contenedor de Telegram Mini Apps con un bot
// nuevo, sin auth ni SDK: si Telegram la abre con el chevron de minimizar,
// el mecanismo de Main Mini App + link directo funciona. Borrar al terminar.
export default function MiniAppTestPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
        fontFamily: "system-ui, sans-serif",
        background: "#0f1a14",
        color: "#e6f4ea",
        textAlign: "center",
        padding: "24px",
      }}
    >
      <div style={{ fontSize: "64px" }}>🐐</div>
      <h1 style={{ fontSize: "28px", margin: 0 }}>Mini App Test</h1>
      <p style={{ margin: 0, opacity: 0.8 }}>
        Si ves la flechita ⌄ arriba a la derecha, el contenedor nuevo funciona.
      </p>
    </div>
  );
}
