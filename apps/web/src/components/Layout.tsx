import { Link, NavLink, Outlet, useLocation } from "react-router";
import { useEffect } from "react";
import { LINKS } from "../lib/links.ts";
import { ButtonLink, Container, Wordmark } from "./ui.tsx";

function Nav() {
  const { pathname } = useLocation();
  const onApp = pathname.startsWith("/app");
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-ink/85 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link to="/" className="rounded-md" aria-label="Crowdline home">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          <a
            href="/#how"
            className="hidden rounded-md px-3 py-2 text-sm text-muted hover:text-fg sm:inline-block"
          >
            How it works
          </a>
          <NavLink
            to="/in"
            className={({ isActive }) =>
              `hidden rounded-md px-3 py-2 text-sm md:inline-block ${isActive ? "text-fg" : "text-muted hover:text-fg"}`
            }
          >
            Into Zcash
          </NavLink>
          <NavLink
            to="/receipt"
            className={({ isActive }) =>
              `hidden rounded-md px-3 py-2 text-sm sm:inline-block ${isActive ? "text-fg" : "text-muted hover:text-fg"}`
            }
          >
            Receipts
          </NavLink>
          <a
            href={LINKS.docs}
            target="_blank"
            rel="noreferrer"
            className="rounded-md px-3 py-2 text-sm text-muted hover:text-fg"
          >
            Docs
          </a>
          {!onApp && (
            <ButtonLink to="/app" className="ml-1 !min-h-9 px-3.5">
              Launch app
            </ButtonLink>
          )}
        </nav>
      </Container>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-24 border-t border-line">
      <Container className="flex flex-col gap-6 py-10 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <Wordmark />
          <p className="m-0 text-faint">Built for Zecathon 2026 · Cross-chain track</p>
        </div>
        <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0">
          <li>
            <a className="hover:text-fg" href={LINKS.repo} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </li>
          <li>
            <a className="hover:text-fg" href={LINKS.zecathon} target="_blank" rel="noreferrer">
              Zecathon
            </a>
          </li>
          <li>
            <Link className="hover:text-fg" to="/receipt">
              Verify a receipt
            </Link>
          </li>
          <li>
            <Link className="hover:text-fg" to="/recover">
              Recover a refund
            </Link>
          </li>
          <li>
            <Link className="hover:text-fg" to="/in">
              Bring assets in
            </Link>
          </li>
          <li>
            <a className="hover:text-fg" href={LINKS.licence} target="_blank" rel="noreferrer">
              MIT licence
            </a>
          </li>
        </ul>
      </Container>
    </footer>
  );
}

export function Layout() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash]);
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-30 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink"
      >
        Skip to content
      </a>
      <Nav />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
