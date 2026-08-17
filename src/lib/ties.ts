/**
 * Generates the sentence that explains shared places, so the copy can never
 * drift from the data. Standard competition ranking means a group of k entries
 * sharing a place consumes the k-1 places below it, and those are not awarded.
 */
import type { ModelEntry } from '../data/models';
import { countWord, ordinalWord } from './format';

export interface TieGroup {
  readonly place: number;
  readonly count: number;
  /** Places consumed by the tie and therefore not awarded. */
  readonly skippedPlaces: readonly number[];
}

export function findTieGroups(entries: readonly ModelEntry[]): readonly TieGroup[] {
  const counts = new Map<number, number>();
  for (const { place } of entries) {
    counts.set(place, (counts.get(place) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort(([a], [b]) => a - b)
    .map(([place, count]) => ({
      place,
      count,
      skippedPlaces: Array.from({ length: count - 1 }, (_, offset) => place + 1 + offset),
    }));
}

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function describeGroup(group: TieGroup): string {
  const skipped = group.skippedPlaces.map(ordinalWord);
  const consequence =
    skipped.length === 1
      ? `so no ${skipped[0]} place is awarded`
      : `so ${joinWords(skipped)} places are not awarded`;

  return `${capitalize(countWord(group.count))} models share ${ordinalWord(group.place)} place, ${consequence}.`;
}

/**
 * One sentence per tied place, or `null` when every place is unique — callers
 * should omit the copy entirely in that case rather than print an empty string.
 */
export function describeTies(entries: readonly ModelEntry[]): string | null {
  const groups = findTieGroups(entries);
  if (groups.length === 0) return null;
  return groups.map(describeGroup).join(' ');
}

const RANKING_PREFACE = 'Places follow standard competition ranking.';

/**
 * The preface plus any tie explanation, ready to drop into copy. Both the table
 * caption and the "Reading the table" section use this, so the two cannot
 * disagree with each other or with the data.
 */
export function describeRanking(entries: readonly ModelEntry[]): string {
  const ties = describeTies(entries);
  return ties ? `${RANKING_PREFACE} ${ties}` : RANKING_PREFACE;
}
