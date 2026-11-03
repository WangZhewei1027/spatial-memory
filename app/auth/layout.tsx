export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-[calc(100svh-var(--app-navbar-height))] w-full items-center justify-center px-6 py-12 sm:px-8 sm:py-16">
      <div className="w-full min-w-0 max-w-md">{children}</div>
    </main>
  );
}
