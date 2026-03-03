import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="bottom-right"
      toastOptions={{
        style: {
          background: "#161b22",
          border: "1px solid #30363d",
          color: "#e6edf3",
        },
      }}
    />
  );
}
