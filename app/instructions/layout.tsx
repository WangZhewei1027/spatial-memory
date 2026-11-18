import type { ReactNode } from "react";

export default function InstructionsLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <article className="prose prose-neutral max-w-none dark:prose-invert">
        {children}
      </article>
    </main>
  );
}
