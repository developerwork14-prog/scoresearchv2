import Link from "next/link";
import { BarChart3, Gauge, LineChart, Link2, Search, Settings, Sparkles } from "lucide-react";

const nav = [
  {
    label: "Integrations",
    items: [
      { href: "/dashboard/integrations/GOOGLE_SEARCH_CONSOLE", label: "Google Search Console", icon: Search },
      { href: "/dashboard/integrations/GOOGLE_ANALYTICS", label: "Google Analytics", icon: BarChart3 },
      { href: "/dashboard/integrations/BING_WEBMASTER", label: "Bing Webmaster Tools", icon: Link2 },
      { href: "/dashboard/integrations", label: "Connection Settings", icon: Settings }
    ]
  },
  {
    label: "Performance",
    items: [
      { href: "/dashboard/performance/search-console", label: "Search Performance", icon: LineChart },
      { href: "/dashboard/performance/analytics", label: "Website Analytics", icon: BarChart3 },
      { href: "/dashboard/performance/bing", label: "Bing Performance", icon: Search },
      { href: "/dashboard/performance/combined-insights", label: "Combined Insights", icon: Sparkles }
    ]
  }
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="app-shell min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto grid min-h-screen max-w-7xl gap-0 lg:grid-cols-[270px_1fr]">
        <aside className="border-b border-black/10 bg-white/82 p-4 backdrop-blur lg:border-b-0 lg:border-r">
          <Link href="/dashboard/integrations" className="mb-6 flex items-center gap-3 rounded-lg p-2">
            <span className="grid size-10 place-items-center rounded-lg bg-ink text-gold">
              <Gauge className="size-5" />
            </span>
            <span>
              <span className="block text-sm font-black text-ink">GLOMAUDIT</span>
              <span className="block text-xs font-bold text-ink/50">SEO intelligence</span>
            </span>
          </Link>
          <nav className="grid gap-5">
            {nav.map((section) => (
              <div key={section.label}>
                <p className="mb-2 px-2 text-xs font-black uppercase tracking-normal text-ink/40">{section.label}</p>
                <div className="grid gap-1">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link key={item.href} href={item.href} className="flex min-h-10 items-center gap-3 rounded-md px-2 text-sm font-bold text-ink/68 transition hover:bg-gold/20 hover:text-ink">
                        <Icon className="size-4" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>
        <section className="min-w-0 p-4 sm:p-6 lg:p-8">{children}</section>
      </div>
    </main>
  );
}
