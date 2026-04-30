const toImbaIdentifierPattern = /[ΞΦΨα]/gu;

const toImbaIdentifierMap: Record<string, string> = {
  "Ξ": "-",
  "Φ": "?",
  "Ψ": "#",
  "α": "@",
};

const generatedInternalPrefixes = new Set([
  "τ",
  "ω",
  "υ",
  "ϲ",
  "κ",
  "φ",
  "ε",
  "ι",
  "Ψ",
  "ρ",
  "Δ",
  "θ",
  "Ω",
]);

export function toImbaIdentifier(value: string): string {
  return value.replace(toImbaIdentifierPattern, (match) => toImbaIdentifierMap[match] ?? match);
}

export function isGeneratedInternalIdentifier(value: string): boolean {
  return generatedInternalPrefixes.has(value[0] ?? "");
}
