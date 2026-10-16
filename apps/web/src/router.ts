import { useEffect, useState } from "react";

export type Route = { name: "home" } | { name: "execution"; id: string } | { name: "not_found" };

function parse(pathname: string): Route {
  if (pathname === "/" || pathname === "") return { name: "home" };
  const m = /^\/e\/([0-9a-f-]{36})\/?$/i.exec(pathname);
  if (m) return { name: "execution", id: m[1]! };
  return { name: "not_found" };
}

export function navigate(path: string) {
  if (path === window.location.pathname) return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(parse(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return route;
}
