export function QueryError({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <p class="error" role="alert">
      {error.message} <button class="link" onClick={retry}>Try again</button>
    </p>
  );
}
