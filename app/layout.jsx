export const metadata = { title: "Kings Cadence" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", background: "#0d1117", color: "#e6edf3" }}>
        {children}
      </body>
    </html>
  );
}
