export function modFloor(a: number, b: number): number {
  const mod = a % b;
  return mod >= 0 ? mod : mod + b;
}