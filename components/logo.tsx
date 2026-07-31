// Minimal Nit wordmark. A lowercase "nit" with a solid review style underline
// caret. No gradients, no shadows.
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline font-semibold tracking-tight ${className}`}>
      <span>nit</span>
      <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-sm bg-destructive" aria-hidden />
    </span>
  );
}
