/**
 * Prices are stored as integer centavos in Postgres so amounts never pass
 * through floating point in the database. The app works in peso numbers.
 *
 * This module is the only place that converts between the two.
 */
export function toCents(pesos: number): number {
  return Math.round(pesos * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}
