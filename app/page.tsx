import { ChatShell } from "@/components/chat-shell";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 sm:px-6">
      <ChatShell />
    </main>
  );
}
