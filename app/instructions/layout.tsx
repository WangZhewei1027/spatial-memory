import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NavigationIsland } from "@/components/ui/navigation-island";
import { Button } from "@/components/ui/button";

export default function InstructionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <NavigationIsland className="mb-8">
      <nav aria-label="Instructions" className="navigation-row justify-between text-sm">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/"><ArrowLeft aria-hidden />Home</Link>
        </Button>
        <div className="flex gap-1">
          <Link
            href="/instructions/en"
            className="rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            English
          </Link>
          <Link
            href="/instructions/zh"
            className="rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            中文
          </Link>
        </div>
      </nav>
      </NavigationIsland>
      <article className="prose prose-neutral dark:prose-invert max-w-none">
        {children}
      </article>
    </div>
  );
}
