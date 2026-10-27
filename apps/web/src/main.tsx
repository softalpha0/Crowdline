import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Layout } from "./components/Layout.tsx";
import { Landing } from "./pages/Landing.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import "./styles.css";

const SwapApp = lazy(() => import("./pages/SwapApp.tsx"));
const Receipt = lazy(() => import("./pages/Receipt.tsx"));

function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16" aria-busy="true">
      <div className="skeleton h-8 w-48" />
      <div className="skeleton mt-6 h-64 w-full" />
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Landing /> },
      {
        path: "/app",
        element: (
          <Suspense fallback={<Loading />}>
            <SwapApp />
          </Suspense>
        ),
      },
      {
        path: "/receipt",
        element: (
          <Suspense fallback={<Loading />}>
            <Receipt />
          </Suspense>
        ),
      },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
