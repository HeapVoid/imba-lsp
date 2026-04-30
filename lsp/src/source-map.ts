import type { ImbaCompilation } from "./compiler";

export interface SourceSpan {
  generatedEnd: number;
  generatedStart: number;
  sourceEnd: number;
  sourceStart: number;
}

export interface OffsetMapping {
  offset: number;
  span: SourceSpan;
}

export function sourceOffsetToGeneratedOffset(
  compilation: ImbaCompilation | undefined,
  source: string,
  sourceOffset: number,
): OffsetMapping | null {
  const generated = compilation?.js;
  if (!generated) return null;

  const span = sourceSpanForOffset(compilation, sourceOffset);
  if (!span) return null;

  return {
    offset: projectSourceOffset(span, source, generated, sourceOffset),
    span,
  };
}

export function generatedOffsetToSourceOffset(
  compilation: ImbaCompilation | undefined,
  source: string,
  generatedOffset: number,
): OffsetMapping | null {
  const generated = compilation?.js;
  if (!generated) return null;

  const span = generatedSpanForOffset(compilation, generatedOffset);
  if (!span) return null;

  return {
    offset: projectGeneratedOffset(span, source, generated, generatedOffset),
    span,
  };
}

export function sourceSpanForOffset(
  compilation: ImbaCompilation | undefined,
  sourceOffset: number,
): SourceSpan | null {
  return bestSpan(normalizedSpans(compilation).filter((span) =>
    containsOffset(span.sourceStart, span.sourceEnd, sourceOffset)
  ), "source");
}

export function generatedSpanForOffset(
  compilation: ImbaCompilation | undefined,
  generatedOffset: number,
): SourceSpan | null {
  return bestSpan(normalizedSpans(compilation).filter((span) =>
    containsOffset(span.generatedStart, span.generatedEnd, generatedOffset)
  ), "generated");
}

export function normalizedSpans(
  compilation: ImbaCompilation | undefined,
): SourceSpan[] {
  const spans = compilation?.locs?.spans ?? [];
  const normalized: SourceSpan[] = [];

  for (const span of spans) {
    if (!Array.isArray(span) || span.length < 4) continue;

    const [generatedStart, generatedEnd, sourceStart, sourceEnd] = span;
    if (
      !finiteNumber(generatedStart) ||
      !finiteNumber(generatedEnd) ||
      !finiteNumber(sourceStart) ||
      !finiteNumber(sourceEnd)
    ) {
      continue;
    }

    if (generatedEnd <= generatedStart || sourceEnd <= sourceStart) continue;

    normalized.push({
      generatedEnd,
      generatedStart,
      sourceEnd,
      sourceStart,
    });
  }

  return normalized;
}

function bestSpan(spans: SourceSpan[], priority: "generated" | "source"): SourceSpan | null {
  spans.sort((left, right) => {
    const primary =
      priority === "source"
        ? spanSourceLength(left) - spanSourceLength(right)
        : spanGeneratedLength(left) - spanGeneratedLength(right);
    if (primary !== 0) return primary;

    const secondary =
      priority === "source"
        ? spanGeneratedLength(left) - spanGeneratedLength(right)
        : spanSourceLength(left) - spanSourceLength(right);
    if (secondary !== 0) return secondary;

    return left.sourceStart - right.sourceStart || left.generatedStart - right.generatedStart;
  });

  return spans[0] ?? null;
}

function projectSourceOffset(
  span: SourceSpan,
  source: string,
  generated: string,
  sourceOffset: number,
): number {
  const sourceText = source.slice(span.sourceStart, span.sourceEnd);
  const generatedText = generated.slice(span.generatedStart, span.generatedEnd);
  const relative = clamp(sourceOffset - span.sourceStart, 0, sourceText.length - 1);

  const generatedIndex = generatedText.lastIndexOf(sourceText);
  if (generatedIndex >= 0) {
    return span.generatedStart + generatedIndex + relative;
  }

  return span.generatedStart + proportionalOffset(relative, sourceText.length, generatedText.length);
}

function projectGeneratedOffset(
  span: SourceSpan,
  source: string,
  generated: string,
  generatedOffset: number,
): number {
  const sourceText = source.slice(span.sourceStart, span.sourceEnd);
  const generatedText = generated.slice(span.generatedStart, span.generatedEnd);
  const relative = clamp(generatedOffset - span.generatedStart, 0, generatedText.length - 1);

  const generatedIndex = generatedText.lastIndexOf(sourceText);
  if (generatedIndex >= 0) {
    const sourceRelative = clamp(relative - generatedIndex, 0, sourceText.length - 1);
    return span.sourceStart + sourceRelative;
  }

  return span.sourceStart + proportionalOffset(relative, generatedText.length, sourceText.length);
}

function containsOffset(start: number, end: number, offset: number): boolean {
  return start <= offset && offset < end;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function proportionalOffset(offset: number, fromLength: number, toLength: number): number {
  if (fromLength <= 1 || toLength <= 1) return 0;
  return clamp(Math.floor((offset / fromLength) * toLength), 0, toLength - 1);
}

function spanGeneratedLength(span: SourceSpan): number {
  return span.generatedEnd - span.generatedStart;
}

function spanSourceLength(span: SourceSpan): number {
  return span.sourceEnd - span.sourceStart;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
