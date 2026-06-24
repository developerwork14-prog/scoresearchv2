import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-[14px] border border-[#ECECEC] bg-white shadow-panel backdrop-blur transition hover:border-[#D9D9D9]", className)} {...props} />;
}

export function Button({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      suppressHydrationWarning
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-bold text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-teal disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-60",
        className
      )}
      {...props}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...inputProps } = props;
  return (
    <input
      suppressHydrationWarning
      className={cn(
        "min-h-12 w-full rounded-[10px] border border-[#ECECEC] bg-white px-3.5 text-sm font-medium text-ink outline-none transition placeholder:text-[#999999] focus:border-[#D9D9D9] focus:ring-4 focus:ring-gold/25",
        className
      )}
      {...inputProps}
    />
  );
}
