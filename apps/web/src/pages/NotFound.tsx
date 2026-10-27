import { ButtonLink, Container } from "../components/ui.tsx";

export function NotFound() {
  return (
    <Container className="py-24">
      <p className="eyebrow">404</p>
      <h1 className="mt-3 text-3xl font-semibold">Nothing here.</h1>
      <p className="mt-3 text-muted">That page does not exist.</p>
      <div className="mt-8">
        <ButtonLink to="/">Back to the start</ButtonLink>
      </div>
    </Container>
  );
}
