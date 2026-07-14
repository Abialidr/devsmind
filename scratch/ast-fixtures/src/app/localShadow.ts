import { parseThing } from '../utils/parse';

// Declares a LOCAL `parseThing` that shadows the import — must NOT link to the imported
// parseThing (the whole point of scope-aware free-variable analysis).
export function handleInput(input: string): string {
  const parseThing = (x: string) => x.toUpperCase();
  return parseThing(input);
}

// Uses the imported parseThing — must link to it.
export function realUse(input: string): string {
  return parseThing(input);
}
