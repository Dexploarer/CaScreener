import Link from "next/link";

const links = [
  { href: "/", label: "UGI (Generate)" },
  { href: "/helius", label: "Helius Dashboard" },
  { href: "/predictions", label: "Predictions" },
  { href: "/a2ui", label: "A2UI" },
  { href: "/adaptive-cards", label: "Adaptive Cards" },
  { href: "/ag-ui", label: "AG-UI" },
  { href: "/openapi", label: "OpenAPI Forms" },
];

export function Nav() {
  return (
    <nav className="border-b border-zinc-800 bg-zinc-900/50">
      <div className="container mx-auto px-4 flex flex-wrap gap-4 py-3">
        {links.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
